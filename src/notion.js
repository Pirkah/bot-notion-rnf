/**
 * Module d'intégration avec l'API Notion (@notionhq/client).
 * Permet au bot de chercher, lire, créer et enrichir des pages dans l'espace Notion de l'équipe.
 */

import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
dotenv.config();

// Initialisation du client Notion
let notionClient = null;

function getNotionClient() {
  if (!process.env.NOTION_API_KEY) {
    throw new Error("La variable d'environnement NOTION_API_KEY n'est pas définie.");
  }
  if (!notionClient) {
    notionClient = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return notionClient;
}

/**
 * Extrait le titre lisible d'une page Notion (gère les différents formats de propriétés).
 */
function extractPageTitle(page) {
  if (!page || !page.properties) return 'Sans titre';

  for (const key of Object.keys(page.properties)) {
    const prop = page.properties[key];
    if (prop.type === 'title' && Array.isArray(prop.title) && prop.title.length > 0) {
      return prop.title.map(t => t.plain_text).join('');
    }
  }

  // Fallback si la page a une propriété "Name" ou "Titre"
  if (page.properties.Name && page.properties.Name.title) {
    return page.properties.Name.title.map(t => t.plain_text).join('');
  }

  return 'Page sans titre';
}

/**
 * Convertit une liste de blocs Notion en texte Markdown lisible pour l'IA et pour Slack.
 */
function convertBlocksToMarkdown(blocks) {
  if (!blocks || !Array.isArray(blocks)) return '';

  const lines = [];

  for (const block of blocks) {
    const type = block.type;
    const blockData = block[type];

    if (!blockData) continue;

    const richText = blockData.rich_text
      ? blockData.rich_text.map(t => t.plain_text).join('')
      : '';

    switch (type) {
      case 'heading_1':
        lines.push(`\n# ${richText}\n`);
        break;
      case 'heading_2':
        lines.push(`\n## ${richText}\n`);
        break;
      case 'heading_3':
        lines.push(`\n### ${richText}\n`);
        break;
      case 'paragraph':
        if (richText.trim()) lines.push(richText);
        break;
      case 'bulleted_list_item':
        lines.push(`- ${richText}`);
        break;
      case 'numbered_list_item':
        lines.push(`1. ${richText}`);
        break;
      case 'to_do':
        lines.push(`[${blockData.checked ? 'x' : ' '}] ${richText}`);
        break;
      case 'toggle':
        lines.push(`▶ ${richText}`);
        break;
      case 'quote':
        lines.push(`> ${richText}`);
        break;
      case 'callout':
        lines.push(`💡 ${richText}`);
        break;
      case 'code':
        lines.push(`\`\`\`${blockData.language || ''}\n${richText}\n\`\`\``);
        break;
      case 'divider':
        lines.push('---');
        break;
      default:
        if (richText.trim()) lines.push(richText);
        break;
    }
  }

  return lines.join('\n');
}

/**
 * Recherche des pages ou des bases de données dans Notion par mot-clé.
 * @param {Object} params
 * @param {string} params.query - Mots-clés de recherche
 * @param {string} [params.filter_type] - Filtre facultatif ("page" ou "database")
 * @returns {Promise<Object>} Résultats de la recherche
 */
export async function searchNotion({ query, filter_type }) {
  try {
    const notion = getNotionClient();
    console.log(`[Notion] Recherche: "${query}" (filtre: ${filter_type || 'tous'})`);

    const searchParams = {
      query: query,
      page_size: 10
    };

    if (filter_type && (filter_type === 'page' || filter_type === 'database')) {
      searchParams.filter = {
        value: filter_type,
        property: 'object'
      };
    }

    const response = await notion.search(searchParams);

    if (!response.results || response.results.length === 0) {
      return {
        message: `Aucun document trouvé dans Notion pour la recherche "${query}". Pensez à vérifier que l'intégration a été invitée sur les pages concernées.`,
        results: []
      };
    }

    const formattedResults = response.results.map(item => {
      const isDatabase = item.object === 'database';
      const title = isDatabase
        ? (item.title && item.title.length > 0 ? item.title[0].plain_text : 'Base de données sans titre')
        : extractPageTitle(item);

      return {
        id: item.id,
        type: item.object,
        title: title,
        url: item.url,
        last_edited_time: item.last_edited_time
      };
    });

    return {
      total: formattedResults.length,
      results: formattedResults
    };
  } catch (error) {
    console.error('[Notion] Erreur lors de la recherche :', error);
    return {
      error: `Erreur lors de la recherche Notion : ${error.message}. Vérifiez la clé NOTION_API_KEY et les connexions aux pages.`
    };
  }
}

/**
 * Lit le contenu textuel et les blocs d'une page Notion à partir de son ID.
 * @param {Object} params
 * @param {string} params.page_id - L'identifiant unique UUID de la page
 * @returns {Promise<Object>} Métadonnées et contenu Markdown de la page
 */
export async function readNotionPage({ page_id }) {
  try {
    const notion = getNotionClient();
    // Nettoyage de l'ID s'il contient des tirets ou provient d'une URL
    const cleanPageId = page_id.replace(/-/g, '');
    console.log(`[Notion] Lecture de la page ID: ${cleanPageId}`);

    // Récupérer les métadonnées de la page (titre, URL)
    const page = await notion.pages.retrieve({ page_id: cleanPageId });
    const title = extractPageTitle(page);
    const url = page.url;

    // Récupérer les blocs de contenu enfants (jusqu'à 100 blocs)
    const blocksResponse = await notion.blocks.children.list({
      block_id: cleanPageId,
      page_size: 100
    });

    const markdownContent = convertBlocksToMarkdown(blocksResponse.results);

    return {
      id: page.id,
      title: title,
      url: url,
      content: markdownContent || '(Cette page est vide ou ne contient que des blocs non textuels)'
    };
  } catch (error) {
    console.error(`[Notion] Erreur lors de la lecture de la page ${page_id} :`, error);
    return {
      error: `Impossible de lire la page Notion (${page_id}) : ${error.message}. Vérifiez que le bot a été invité sur cette page Notion (Menu "..." > Connexions).`
    };
  }
}

/**
 * Crée une nouvelle page dans Notion avec un titre et du contenu.
 * @param {Object} params
 * @param {string} params.title - Titre de la nouvelle page
 * @param {string} params.content - Contenu textuel de la page
 * @param {string} [params.parent_page_id] - ID de la page parente (optionnel, prend NOTION_ROOT_PAGE_ID par défaut)
 * @returns {Promise<Object>} Page créée
 */
export async function createNotionPage({ title, content, parent_page_id }) {
  try {
    const notion = getNotionClient();
    const parentId = (parent_page_id || process.env.NOTION_ROOT_PAGE_ID || '').replace(/-/g, '');

    if (!parentId) {
      return {
        error: "Aucune page parente spécifiée (parent_page_id manquant et NOTION_ROOT_PAGE_ID non configuré dans .env)."
      };
    }

    console.log(`[Notion] Création de la page "${title}" sous le parent: ${parentId}`);

    // Découpage du contenu en paragraphes pour Notion
    const paragraphs = content.split('\n\n').filter(p => p.trim());
    const childrenBlocks = paragraphs.map(p => ({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: p.length > 1900 ? p.substring(0, 1900) + '...' : p
            }
          }
        ]
      }
    }));

    const newPage = await notion.pages.create({
      parent: { page_id: parentId },
      properties: {
        title: {
          title: [
            {
              type: 'text',
              text: { content: title }
            }
          ]
        }
      },
      children: childrenBlocks.length > 0 ? childrenBlocks : undefined
    });

    return {
      status: 'success',
      message: `Page "${title}" créée avec succès dans Notion !`,
      id: newPage.id,
      url: newPage.url
    };
  } catch (error) {
    console.error('[Notion] Erreur lors de la création de la page :', error);
    return {
      error: `Erreur lors de la création de la page Notion : ${error.message}`
    };
  }
}

/**
 * Ajoute du contenu textuel à la fin d'une page Notion existante.
 * @param {Object} params
 * @param {string} params.page_id - L'identifiant unique de la page
 * @param {string} params.content - Contenu à ajouter
 * @returns {Promise<Object>} Résultat de l'ajout
 */
export async function appendNotionPage({ page_id, content }) {
  try {
    const notion = getNotionClient();
    const cleanPageId = page_id.replace(/-/g, '');
    console.log(`[Notion] Ajout de contenu sur la page: ${cleanPageId}`);

    const paragraphs = content.split('\n\n').filter(p => p.trim());
    const childrenBlocks = paragraphs.map(p => ({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: p.length > 1900 ? p.substring(0, 1900) + '...' : p
            }
          }
        ]
      }
    }));

    await notion.blocks.children.append({
      block_id: cleanPageId,
      children: childrenBlocks
    });

    return {
      status: 'success',
      message: `Contenu ajouté avec succès à la page Notion (${cleanPageId}).`
    };
  } catch (error) {
    console.error('[Notion] Erreur lors de l\'ajout de contenu :', error);
    return {
      error: `Erreur lors de l'ajout de contenu dans Notion : ${error.message}`
    };
  }
}
