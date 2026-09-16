/**
 * Utilitaires pour le formatage et l'envoi de messages Slack.
 * Intègre un filtre strict de conformité RGPD pour masquer les coordonnées personnelles
 * (adresses emails et numéros de téléphone de partenaires, fournisseurs ou étudiants).
 */

/**
 * Filtre de conformité RGPD :
 * Détecte et masque automatiquement les adresses emails et numéros de téléphone
 * afin d'empêcher toute fuite de données personnelles ou professionnelles de partenaires/fournisseurs.
 *
 * @param {string} text - Texte brut ou Markdown
 * @returns {string} - Texte anonymisé conforme RGPD
 */
export function sanitizePII(text) {
  if (!text || typeof text !== 'string') return text || '';

  let sanitized = text;

  // 1. Masquage des adresses emails (ex: contact@fournisseur.com, nom.prenom@entreprise.fr)
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi;
  sanitized = sanitized.replace(emailRegex, '[EMAIL_MASQUÉ_RGPD]');

  // 2. Masquage des numéros de téléphone français :
  // Formats supportés : 06 12 34 56 78, 06.12.34.56.78, 06-12-34-56-78, 0612345678,
  // +33 6 12 34 56 78, +33(0)612345678, 0033 6..., etc.
  const frPhoneRegex = /(?:(?:\+|00)33[\s.-]?(?:\(0\)[\s.-]?)?|0)[1-9](?:[\s.-]?\d{2}){4}\b/g;
  sanitized = sanitized.replace(frPhoneRegex, '[TÉL_MASQUÉ_RGPD]');

  // 3. Masquage des numéros de téléphone internationaux
  const intlPhoneRegex = /(?:\+|00)[1-9]\d{0,2}[\s.-]?(?:\(\d+\)[\s.-]?)?(?:\d[\s.-]?){7,11}\d\b/g;
  sanitized = sanitized.replace(intlPhoneRegex, '[TÉL_MASQUÉ_RGPD]');

  return sanitized;
}

/**
 * Nettoie les balises de mention Slack (ex: <@U12345678>) au début ou dans le texte.
 * @param {string} text - Message brut reçu de Slack
 * @returns {string} - Texte nettoyé
 */
export function cleanSlackPrompt(text) {
  if (!text) return '';
  return text.replace(/<@[A-Z0-9]+>/g, '').trim();
}

/**
 * Convertit le Markdown standard généré par Gemini au format mrkdwn utilisé par Slack
 * tout en appliquant le filtre de protection RGPD.
 * - [Titre](URL) => <URL|Titre>
 * - **Gras** => *Gras*
 * - En-têtes (#, ##, ###) => *Titre en gras*
 * @param {string} markdown - Texte en Markdown standard
 * @returns {string} - Texte formaté et sécurisé pour Slack
 */
export function formatMarkdownForSlack(markdown) {
  if (!markdown) return '';

  // Application préalable du filtre RGPD
  let formatted = sanitizePII(markdown);

  // Conversion des liens Markdown [texte](url) vers le format Slack <url|texte>
  formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<$2|$1>');

  // Conversion des titres Markdown (# Titre, ## Titre, etc.) en gras Slack
  formatted = formatted.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Conversion de **gras** en *gras* Slack
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '*$1*');

  return formatted;
}

/**
 * Découpe un message long en morceaux de moins de 3900 caractères
 * pour respecter la limite de 4000 caractères par message imposée par Slack.
 * @param {string} text - Texte complet
 * @param {number} maxLength - Taille max par morceau (défaut: 3800)
 * @returns {string[]} - Tableau de morceaux de texte
 */
export function splitSlackMessage(text, maxLength = 3800) {
  if (!text || text.length <= maxLength) return [text || ''];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Chercher le dernier saut de ligne avant la limite
    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      // Si pas de saut de ligne approprié, chercher un espace
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex === -1) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.substring(0, splitIndex).trim());
    remaining = remaining.substring(splitIndex).trim();
  }

  return chunks;
}

/**
 * Ajoute un emoji de réaction à un message de façon sécurisée (ignore les erreurs).
 */
export async function safeAddReaction(client, channel, timestamp, name) {
  try {
    await client.reactions.add({
      channel,
      timestamp,
      name
    });
  } catch (err) {
    // Si la réaction existe déjà ou qu'il manque un droit, on ne bloque pas le bot
    console.warn(`[Slack] Impossible d'ajouter la réaction ${name} :`, err.message);
  }
}

/**
 * Retire un emoji de réaction de façon sécurisée.
 */
export async function safeRemoveReaction(client, channel, timestamp, name) {
  try {
    await client.reactions.remove({
      channel,
      timestamp,
      name
    });
  } catch (err) {
    // Ignoré si la réaction n'existe plus
  }
}
