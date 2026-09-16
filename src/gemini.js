/**
 * Module d'interaction avec l'API Google Gemini (@google/genai).
 * Gère le modèle configurable, le Google Search Tool et les outils Notion via Function Calling.
 *
 * CONFORMITÉ RGPD :
 * Le prompt système et les filtres imposent une stricte protection des données personnelles
 * des partenaires, fournisseurs et étudiants.
 */

import { GoogleGenAI } from '@google/genai';
import { searchNotion, readNotionPage, createNotionPage, appendNotionPage } from './notion.js';
import { sanitizePII } from './slackUtils.js';
import dotenv from 'dotenv';
dotenv.config();

// Initialisation du client Google GenAI
let aiClient = null;

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("La variable d'environnement GEMINI_API_KEY n'est pas définie.");
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

/**
 * Récupère le modèle configuré dans l'environnement, avec fallback sur gemini-3.8-flash.
 */
export function getModelName() {
  return process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
}

/**
 * Définition des outils (Tools) disponibles pour Gemini :
 * 1. Google Search (recherche web en direct)
 * 2. Fonctions personnalisées Notion (recherche, lecture, création, ajout)
 */
const notionToolsDefinitions = [
  {
    type: 'google_search'
  },
  {
    type: 'function',
    name: 'search_notion',
    description: 'Recherche des pages ou bases de données dans l\'espace Notion du projet par mots-clés.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Mots-clés ou termes à rechercher dans Notion'
        },
        filter_type: {
          type: 'string',
          enum: ['page', 'database'],
          description: 'Optionnel: filtrer uniquement par page ou par base de données'
        }
      },
      required: ['query']
    }
  },
  {
    type: 'function',
    name: 'read_notion_page',
    description: 'Lit le contenu textuel complet et structuré d\'une page Notion à partir de son identifiant (page_id).',
    parameters: {
      type: 'object',
      properties: {
        page_id: {
          type: 'string',
          description: 'L\'identifiant UUID de la page Notion (32 caractères, avec ou sans tirets)'
        }
      },
      required: ['page_id']
    }
  },
  {
    type: 'function',
    name: 'create_notion_page',
    description: 'Crée une nouvelle page de compte-rendu, de synthèse ou de notes dans Notion.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Titre de la page Notion'
        },
        content: {
          type: 'string',
          description: 'Contenu complet de la page structuré en paragraphes'
        },
        parent_page_id: {
          type: 'string',
          description: 'ID de la page parente sous laquelle créer la page (optionnel, prend la racine du projet par défaut)'
        }
      },
      required: ['title', 'content']
    }
  },
  {
    type: 'function',
    name: 'append_to_notion_page',
    description: 'Ajoute des notes ou du contenu à la suite d\'une page Notion existante.',
    parameters: {
      type: 'object',
      properties: {
        page_id: {
          type: 'string',
          description: 'L\'identifiant de la page Notion à modifier'
        },
        content: {
          type: 'string',
          description: 'Texte ou paragraphe à ajouter à la fin de la page'
        }
      },
      required: ['page_id', 'content']
    }
  }
];

const SYSTEM_INSTRUCTION = `Tu es RnF Bot, un membre à part entière de l'équipe étudiante du projet BUT GEA.
Ton rôle est d'assister l'équipe avec bienveillance, rigueur et professionnalisme.

🛡️ RÈGLE ABSOLUE DE PROTECTION RGPD :
Tu es strictement tenu au respect du Règlement Général sur la Protection des Données (RGPD).
Il t'est formellement interdit de diffuser, mémoriser ou chercher à reconstituer des coordonnées personnelles privées (numéros de téléphone personnels ou professionnels, adresses e-mail nominatives) de nos partenaires, fournisseurs ou étudiants.
Toutes les données issues de Notion sont automatiquement anonymisées. Si un utilisateur te demande explicitement le numéro ou le mail direct d'un contact, rappelle courtoisement que ces données sont masquées et protégées par la politique RGPD du projet, et invite l'utilisateur à consulter directement la fiche sécurisée sur Notion.

Tes capacités clés :
1. Notion de l'équipe : Tu as accès direct à l'espace de travail Notion de notre projet. Si un étudiant te pose une question sur l'avancement, les tâches, les réunions, les cours ou les documents de travail, utilise impérativement l'outil 'search_notion' puis 'read_notion_page' pour consulter les informations réelles avant de répondre. Tu peux aussi créer des pages ou ajouter des notes si demandé.
2. Recherche Web en direct : Grâce à l'outil Google Search, tu as accès à Internet en direct. Utilise-le chaque fois qu'une question porte sur une information récente, un chiffre économique, une réglementation, une définition ou une source externe.
3. Style de communication : Sois clair, concis et structuré. Utilise des listes à puces, mets les termes importants en gras (*mot*). Si tu t'appuies sur une page Notion ou une source web, mentionne toujours le lien vers la source.`;

/**
 * Exécute l'action Notion demandée par le modèle Gemini.
 */
async function executeNotionFunction(name, args) {
  console.log(`[Gemini Tool] Appel de la fonction ${name} avec arguments :`, JSON.stringify(args));
  switch (name) {
    case 'search_notion':
      return await searchNotion(args);
    case 'read_notion_page':
      return await readNotionPage(args);
    case 'create_notion_page':
      return await createNotionPage(args);
    case 'append_to_notion_page':
      return await appendNotionPage(args);
    default:
      return { error: `Fonction inconnue : ${name}` };
  }
}

/**
 * Génère une réponse via l'API Gemini Interactions en gérant automatiquement
 * la boucle de Function Calling avec Notion et les recherches web Google Search.
 *
 * @param {string} userPrompt - La question ou demande de l'utilisateur Slack
 * @param {Array} [conversationHistory] - Historique éventuel de la conversation
 * @returns {Promise<string>} - La réponse textuelle finale à envoyer sur Slack
 */
export async function generateGeminiResponse(userPrompt, conversationHistory = []) {
  try {
    const client = getAiClient();
    const model = getModelName();

    console.log(`[Gemini] Envoi de la requête au modèle "${model}"...`);

    // Préparation de l'entrée : si on a de l'historique de thread ou une question simple
    let inputContent = userPrompt;
    if (conversationHistory && conversationHistory.length > 0) {
      const historyContext = conversationHistory
        .map(msg => `${msg.user}: ${msg.text}`)
        .join('\n');
      inputContent = `Contexte de la discussion précédente :\n${historyContext}\n\nNouvelle demande de l'utilisateur :\n${userPrompt}`;
    }

    // Appel initial à Gemini avec Google Search et les outils Notion
    let currentInteraction = await client.interactions.create({
      model: model,
      input: inputContent,
      tools: notionToolsDefinitions,
      system_instruction: SYSTEM_INSTRUCTION
    });

    // Boucle agentique pour traiter les appels de fonctions (Notion)
    const MAX_TURNS = 6;
    let turns = 0;

    while (turns < MAX_TURNS) {
      turns++;

      const functionCalls = currentInteraction.steps?.filter(
        step => step.type === 'function_call'
      ) || [];

      if (functionCalls.length === 0) {
        break;
      }

      console.log(`[Gemini Turn ${turns}] ${functionCalls.length} fonction(s) à exécuter...`);

      const functionResults = [];
      for (const fc of functionCalls) {
        const result = await executeNotionFunction(fc.name, fc.arguments);
        functionResults.push({
          type: 'function_result',
          name: fc.name,
          call_id: fc.id,
          result: [
            {
              type: 'text',
              text: JSON.stringify(result)
            }
          ]
        });
      }

      currentInteraction = await client.interactions.create({
        model: model,
        input: functionResults,
        tools: notionToolsDefinitions,
        previous_interaction_id: currentInteraction.id
      });
    }

    // Récupération de la réponse textuelle finale
    let responseText = currentInteraction.output_text;

    if (!responseText) {
      const outputStep = currentInteraction.steps?.find(s => s.type === 'model_output');
      if (outputStep && outputStep.content) {
        const textParts = outputStep.content.filter(c => c.type === 'text');
        if (textParts.length > 0) {
          responseText = textParts.map(p => p.text).join('\n');
        }
      }
    }

    // Filtrage ultime de sécurité RGPD sur la réponse finale
    const finalSafeText = sanitizePII(responseText || "Je n'ai pas pu formuler de réponse. Veuillez réessayer votre question.");
    return finalSafeText;
  } catch (error) {
    console.error('[Gemini] Erreur lors de la génération :', error);

    if (error.message?.includes('API_KEY_INVALID') || error.message?.includes('GEMINI_API_KEY')) {
      return "⚠️ *Erreur de configuration Gemini* : Votre clé d'API `GEMINI_API_KEY` semble invalide ou manquante. Vérifiez votre fichier `.env` ou les paramètres de votre hébergeur.";
    }
    if (error.message?.includes('RESOURCE_EXHAUSTED')) {
      return "⚠️ *Limite de requêtes atteinte* : Le quota temporaire de l'API gratuite Gemini a été atteint. Attendez une ou deux minutes avant de réitérer votre demande.";
    }
    if (error.message?.includes('NOTION_API_KEY')) {
      return "⚠️ *Erreur de configuration Notion* : La clé `NOTION_API_KEY` n'est pas configurée dans les variables d'environnement.";
    }

    return `⚠️ Une erreur est survenue lors du traitement de votre demande : ${error.message}`;
  }
}
