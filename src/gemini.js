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
 * Récupère le modèle configuré dans l'environnement.
 * Par défaut : gemini-3.6-flash (modèle récent, stable et gratuit).
 * Si un ancien modèle obsolète (ex: 2.5 ou 1.5) a été configuré, bascule automatiquement.
 */
export function getModelName() {
  const configured = process.env.GEMINI_MODEL?.trim();
  if (!configured) return 'gemini-3.6-flash';
  if (configured.includes('2.5') || configured.includes('1.5') || configured.includes('2.0')) {
    console.warn(`[Gemini] Le modèle configuré "${configured}" est obsolète sur l'API Interactions. Bascule automatique sur "gemini-3.6-flash".`);
    return 'gemini-3.6-flash';
  }
  return configured;
}

/**
 * Attend que l'interaction Gemini soit complètement terminée (statut !== 'in_progress').
 */
async function waitForInteractionCompletion(client, interaction, onProgress = null) {
  let current = interaction;
  let attempts = 0;
  const maxAttempts = 30; // Jusqu'à 30 secondes d'attente

  while (current && current.status === 'in_progress' && attempts < maxAttempts) {
    attempts++;
    console.log(`[Gemini] Interaction ${current.id} en cours... attente 1s (tentative ${attempts}/${maxAttempts})`);
    if (attempts === 2 && onProgress && typeof onProgress === 'function') {
      await onProgress('✍️ _Rédaction de la réponse en cours..._');
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      current = await client.interactions.get(current.id);
    } catch (pollErr) {
      console.warn(`[Gemini] Erreur lors de la vérification de l'interaction ${current.id} :`, pollErr.message);
      break;
    }
  }

  console.log(`[Gemini] Statut de l'interaction ${current?.id} : ${current?.status}`);
  return current;
}

/**
 * Enveloppe robuste pour les appels Gemini avec réessai automatique en cas de quota 429
 * et attente de la complétion effective de l'interaction.
 */
async function safeInteractionCreate(client, params, onProgress) {
  try {
    const interaction = await client.interactions.create(params);
    return await waitForInteractionCompletion(client, interaction, onProgress);
  } catch (err) {
    const isRateLimit =
      err.message?.includes('429') ||
      err.message?.includes('quota') ||
      err.message?.includes('RESOURCE_EXHAUSTED') ||
      err.message?.includes('rate-limits');

    if (isRateLimit) {
      const matchSeconds = err.message?.match(/retry in ([0-9.]+)s/i);
      const waitSec = matchSeconds ? Math.min(Math.ceil(parseFloat(matchSeconds[1])), 45) : 20;

      console.warn(`[Gemini] Quota temporaire atteint (429). Pause automatique de ${waitSec}s...`);
      if (onProgress && typeof onProgress === 'function') {
        await onProgress(`⏳ _Forte affluence sur le quota gratuit : pause de ${waitSec}s puis reprise automatique..._`);
      }

      // Attente automatique
      await new Promise(resolve => setTimeout(resolve, (waitSec + 1) * 1000));

      if (onProgress && typeof onProgress === 'function') {
        await onProgress('✍️ _Reprise et finalisation en cours..._');
      }

      // Deuxième tentative
      const retryInteraction = await client.interactions.create(params);
      return await waitForInteractionCompletion(client, retryInteraction, onProgress);
    }
    throw err;
  }
}

/**
 * Définition des outils (Tools) disponibles pour Gemini.
 * Note importante : La recherche Google Search nécessite une carte bancaire liée sur Google Cloud
 * (même si 5000 requêtes sont gratuites). Sur le plan 100% gratuit sans carte, Google Search
 * provoque une erreur 429. On l'active donc uniquement si ENABLE_GOOGLE_SEARCH=true.
 */
function getTools(enableSearch = false) {
  const tools = [
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
      description: 'Lit le contenu d\'une page OU les éléments d\'une base de données Notion (tableau des tâches, idées, planning, contacts) à partir de son identifiant (page_id).',
      parameters: {
        type: 'object',
        properties: {
          page_id: {
            type: 'string',
            description: 'L\'identifiant UUID de la page ou de la base de données Notion (32 caractères, avec ou sans tirets)'
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

  if (enableSearch) {
    tools.unshift({ type: 'google_search' });
  }

  return tools;
}

const SYSTEM_INSTRUCTION = `Tu es RnF Bot, un membre à part entière de l'équipe étudiante du projet BUT GEA.
Ton rôle est d'assister l'équipe avec bienveillance, rigueur et professionnalisme.

🛡️ RÈGLE ABSOLUE DE PROTECTION RGPD :
Tu es strictement tenu au respect du Règlement Général sur la Protection des Données (RGPD).
Il t'est formellement interdit de diffuser, mémoriser ou chercher à reconstituer des coordonnées personnelles privées (numéros de téléphone personnels ou professionnels, adresses e-mail nominatives) de nos partenaires, fournisseurs ou étudiants.
Toutes les données issues de Notion sont automatiquement anonymisées. Si un utilisateur te demande explicitement le numéro ou le mail direct d'un contact, rappelle courtoisement que ces données sont masquées et protégées par la politique RGPD du projet, et invite l'utilisateur à consulter directement la fiche sécurisée sur Notion.

Tes capacités clés :
1. Notion de l'équipe : Tu as accès direct à l'espace de travail Notion de notre projet. Si un étudiant te pose une question sur l'avancement, les tâches, les réunions, les cours ou les documents de travail, utilise impérativement l'outil 'search_notion' puis 'read_notion_page' pour consulter les informations réelles avant de répondre. Tu peux aussi créer des pages ou ajouter des notes si demandé.
2. Style de communication : Sois clair, concis et structuré. Utilise des listes à puces, mets les termes importants en gras (*mot*). Si tu t'appuies sur une page Notion, mentionne toujours le lien vers la page.`;

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
export async function generateGeminiResponse(userPrompt, conversationHistory = [], onProgress = null) {
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

    // Outils actifs : Google Search uniquement si activé via ENABLE_GOOGLE_SEARCH=true
    let useSearch = process.env.ENABLE_GOOGLE_SEARCH === 'true';
    let tools = getTools(useSearch);

    let currentInteraction;
    try {
      currentInteraction = await safeInteractionCreate(
        client,
        {
          model: model,
          input: inputContent,
          tools: tools,
          system_instruction: SYSTEM_INSTRUCTION
        },
        onProgress
      );
    } catch (apiError) {
      // Si l'erreur est un 429 (quota) et que Google Search était actif, on réessaie immédiatement sans Search
      if (useSearch && (apiError.message?.includes('429') || apiError.message?.includes('quota'))) {
        console.warn('[Gemini] Quota Google Search dépassé (plan gratuit sans CB). Bascule automatique en mode Notion standard.');
        tools = getTools(false);
        currentInteraction = await safeInteractionCreate(
          client,
          {
            model: model,
            input: inputContent,
            tools: tools,
            system_instruction: SYSTEM_INSTRUCTION
          },
          onProgress
        );
      } else {
        throw apiError;
      }
    }

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
        // Notification visuelle de l'avancée pour l'utilisateur dans Slack
        if (onProgress && typeof onProgress === 'function') {
          if (fc.name === 'search_notion') {
            await onProgress(`🔍 _Recherche dans votre espace Notion : "${fc.arguments?.query || ''}"..._`);
          } else if (fc.name === 'read_notion_page') {
            await onProgress('📖 _Lecture et analyse du document Notion..._');
          } else if (fc.name === 'create_notion_page') {
            await onProgress(`✍️ _Création de la page "${fc.arguments?.title || ''}" dans Notion..._`);
          } else if (fc.name === 'append_to_notion_page') {
            await onProgress('📝 _Ajout des notes sur la page Notion..._');
          }
        }

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

      currentInteraction = await safeInteractionCreate(
        client,
        {
          model: model,
          input: functionResults,
          tools: tools,
          previous_interaction_id: currentInteraction.id
        },
        onProgress
      );
    }

    console.log(`[Gemini] Statut final de l'interaction : ${currentInteraction.status}`);
    if (currentInteraction.steps) {
      console.log(`[Gemini] Étapes reçues : ${currentInteraction.steps.map(s => s.type).join(' -> ')}`);
    }

    // Récupération robuste de la réponse textuelle
    let responseText = extractTextFromInteraction(currentInteraction);

    if (!responseText) {
      console.warn('[Gemini] Aucun texte extrait. Détails de l\'interaction :', JSON.stringify(currentInteraction, null, 2));

      if (currentInteraction.errors && currentInteraction.errors.length > 0) {
        const errMsgs = currentInteraction.errors.map(e => e.message || e.code).join(', ');
        return `⚠️ Le modèle n'a pas pu formuler de réponse : ${errMsgs}`;
      }
      if (currentInteraction.status === 'failed') {
        return "⚠️ Le traitement a été interrompu par Gemini. Veuillez reposer votre question dans un instant.";
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
    if (
      error.message?.includes('429') ||
      error.message?.includes('quota') ||
      error.message?.includes('RESOURCE_EXHAUSTED') ||
      error.message?.includes('rate-limits')
    ) {
      const matchSeconds = error.message?.match(/retry in ([0-9.]+)s/i);
      const waitTime = matchSeconds ? Math.ceil(parseFloat(matchSeconds[1])) : 30;

      return `⏳ *Un instant s'il vous plaît* : Le quota temporaire de requêtes gratuites par minute pour le modèle actuel est atteint.
Veuillez patienter environ *${waitTime} secondes* avant de reposer votre question.

💡 *Conseil pour l'équipe* : Si vous avez renseigné une variable \`GEMINI_MODEL\` dans Render, nous vous conseillons \`gemini-3.6-flash\`.`;
    }
    if (error.message?.includes('NOTION_API_KEY')) {
      return "⚠️ *Erreur de configuration Notion* : La clé `NOTION_API_KEY` n'est pas configurée dans les variables d'environnement.";
    }

    return `⚠️ Une erreur est survenue lors du traitement de votre demande : ${error.message}`;
  }
}

/**
 * Extrait intelligemment le texte généré à partir de tout type de structure renvoyée par Gemini.
 * Compatible avec les différentes versions du schéma (output_text, outputs, steps, candidates).
 */
export function extractTextFromInteraction(interaction) {
  if (!interaction) return '';

  // 1. Propriété directe du SDK (@google/genai convenience property)
  if (typeof interaction.output_text === 'string' && interaction.output_text.trim()) {
    return interaction.output_text.trim();
  }

  // 2. Propriété directe 'text'
  if (typeof interaction.text === 'string' && interaction.text.trim()) {
    return interaction.text.trim();
  }

  // 3. Tableau outputs (compatibilité schéma REST standard)
  if (Array.isArray(interaction.outputs) && interaction.outputs.length > 0) {
    const texts = interaction.outputs
      .map(o => {
        if (typeof o === 'string') return o;
        if (o && typeof o.text === 'string') return o.text;
        return '';
      })
      .filter(Boolean);
    if (texts.length > 0) {
      return texts.join('\n').trim();
    }
  }

  // 4. Tableau d'étapes (steps)
  if (Array.isArray(interaction.steps) && interaction.steps.length > 0) {
    // A. Chercher en priorité les étapes de type 'model_output'
    const modelSteps = interaction.steps.filter(s => s.type === 'model_output' || s.type === 'text');
    if (modelSteps.length > 0) {
      const stepTexts = [];
      for (const step of modelSteps) {
        if (typeof step.text === 'string' && step.text.trim()) {
          stepTexts.push(step.text.trim());
        } else if (Array.isArray(step.content)) {
          for (const item of step.content) {
            if (typeof item === 'string' && item.trim()) {
              stepTexts.push(item.trim());
            } else if (item && typeof item.text === 'string' && item.text.trim()) {
              stepTexts.push(item.text.trim());
            }
          }
        } else if (typeof step.content === 'string' && step.content.trim()) {
          stepTexts.push(step.content.trim());
        }
      }
      if (stepTexts.length > 0) {
        return stepTexts.join('\n').trim();
      }
    }

    // B. Parcourir de la fin vers le début pour toute étape avec du texte valide
    for (let i = interaction.steps.length - 1; i >= 0; i--) {
      const step = interaction.steps[i];
      if (
        step.type === 'thought' ||
        step.type === 'function_call' ||
        step.type === 'function_result' ||
        step.type === 'user_input'
      ) {
        continue;
      }
      if (typeof step.text === 'string' && step.text.trim()) {
        return step.text.trim();
      }
      if (Array.isArray(step.content)) {
        const texts = step.content
          .map(c => (typeof c === 'string' ? c : c?.text || ''))
          .filter(Boolean);
        if (texts.length > 0) {
          return texts.join('\n').trim();
        }
      }
    }
  }

  // 5. Structure 'candidates' (format generateContent classique)
  if (Array.isArray(interaction.candidates) && interaction.candidates[0]?.content?.parts) {
    const parts = interaction.candidates[0].content.parts
      .map(p => (typeof p === 'string' ? p : p?.text || ''))
      .filter(Boolean);
    if (parts.length > 0) {
      return parts.join('\n').trim();
    }
  }

  return '';
}
