/**
 * Point d'entrée principal de l'application :
 * - Démarre l'application Slack Bolt en Socket Mode (WebSocket sortant, sans webhook public).
 * - Lance un serveur HTTP léger sur le port requis par Render (plan gratuit).
 * - Gère les mentions (@RnF Bot) et les messages directs (DM).
 */

import http from 'http';
import pkg from '@slack/bolt';
const { App } = pkg;
import dotenv from 'dotenv';
import { generateGeminiResponse, getModelName } from './gemini.js';
import {
  cleanSlackPrompt,
  formatMarkdownForSlack,
  splitSlackMessage,
  safeAddReaction,
  safeRemoveReaction
} from './slackUtils.js';

dotenv.config();

// ==============================================================================
// 1. VÉRIFICATION DE LA CONFIGURATION
// ==============================================================================
const REQUIRED_VARS = [
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_SIGNING_SECRET',
  'GEMINI_API_KEY',
  'NOTION_API_KEY'
];

const missingVars = REQUIRED_VARS.filter(key => !process.env[key]);
if (missingVars.length > 0) {
  console.warn('⚠️ ATTENTION : Certaines variables d\'environnement sont manquantes :');
  missingVars.forEach(v => console.warn(`   - ${v}`));
  console.warn('Veuillez renseigner ces variables dans votre fichier .env ou dans le tableau de bord Render.\n');
}

// Vérification du format des tokens Slack
if (process.env.SLACK_BOT_TOKEN && !process.env.SLACK_BOT_TOKEN.startsWith('xoxb-')) {
  console.warn('⚠️ ATTENTION : SLACK_BOT_TOKEN doit commencer par "xoxb-". Vérifiez que vous n\'avez pas inversé avec SLACK_APP_TOKEN.');
}
if (process.env.SLACK_APP_TOKEN && !process.env.SLACK_APP_TOKEN.startsWith('xapp-')) {
  console.warn('⚠️ ATTENTION : SLACK_APP_TOKEN doit commencer par "xapp-". Vérifiez que vous n\'avez pas inversé avec SLACK_BOT_TOKEN.');
}

// ==============================================================================
// 2. MINI-SERVEUR HTTP DE SANTÉ (Healthcheck indispensable pour Render gratuit)
// ==============================================================================
const PORT = process.env.PORT || 3000;

const healthServer = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        status: 'ok',
        app: 'RnF Slack-Gemini-Notion Bot',
        model: getModelName(),
        socketMode: true,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      }, null, 2)
    );
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Page non trouvée');
  }
});

healthServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Serveur HTTP de santé en écoute sur 0.0.0.0:${PORT} (compatible Render)`);
});

// ==============================================================================
// 3. INITIALISATION DE L'APPLICATION SLACK BOLT (SOCKET MODE)
// ==============================================================================
const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true
});

// Capture globale des erreurs de connexion Slack
slackApp.error(async (error) => {
  console.error('❌ [Slack Bolt Error] Une erreur Slack est survenue :', error.message || error);
});

/**
 * Récupère l'historique récent du fil de discussion (thread) pour garder le contexte.
 */
async function getThreadHistory(client, channel, threadTs) {
  if (!threadTs) return [];
  try {
    const result = await client.conversations.replies({
      channel: channel,
      ts: threadTs,
      limit: 8
    });

    if (!result.messages || result.messages.length === 0) return [];

    return result.messages.map(msg => ({
      user: msg.bot_id ? 'Assistant (Bot)' : 'Étudiant',
      text: cleanSlackPrompt(msg.text)
    }));
  } catch (err) {
    console.warn('[Slack] Impossible de charger l\'historique du thread :', err.message);
    return [];
  }
}

/**
 * Traite un message utilisateur, appelle Gemini et répond dans Slack.
 */
async function handleUserMessage({ client, channel, text, threadTs, messageTs }) {
  console.log(`[Slack] Traitement du message reçu : "${text}"`);
  const prompt = cleanSlackPrompt(text);

  if (!prompt) {
    await client.chat.postMessage({
      channel: channel,
      thread_ts: threadTs || messageTs,
      text: "👋 Bonjour ! Je suis votre assistant de projet. Posez-moi une question sur le projet, demandez-moi de chercher dans Notion ou de faire une recherche sur le web !"
    });
    return;
  }

  // Ajout de l'émoji sablier pour indiquer la prise en charge
  await safeAddReaction(client, channel, messageTs, 'hourglass_flowing_sand');

  try {
    // Récupérer l'historique du fil si on est dans un thread
    let history = [];
    if (threadTs) {
      history = await getThreadHistory(client, channel, threadTs);
    }

    // Appel à Gemini avec recherche web et fonctions Notion
    const response = await generateGeminiResponse(prompt, history);

    // Formatage et découpage du message si nécessaire
    const formattedResponse = formatMarkdownForSlack(response);
    const chunks = splitSlackMessage(formattedResponse);

    for (const chunk of chunks) {
      await client.chat.postMessage({
        channel: channel,
        thread_ts: threadTs || messageTs,
        text: chunk
      });
    }

    // Remplacement du sablier par une coche verte de confirmation
    await safeRemoveReaction(client, channel, messageTs, 'hourglass_flowing_sand');
    await safeAddReaction(client, channel, messageTs, 'white_check_mark');
  } catch (err) {
    console.error('[Slack] Erreur lors du traitement du message :', err);
    await safeRemoveReaction(client, channel, messageTs, 'hourglass_flowing_sand');
    await safeAddReaction(client, channel, messageTs, 'warning');

    await client.chat.postMessage({
      channel: channel,
      thread_ts: threadTs || messageTs,
      text: `⚠️ Désolé, une erreur inattendue est survenue : ${err.message}`
    });
  }
}

// ==============================================================================
// 4. ÉVÉNEMENTS SLACK
// ==============================================================================

// Événement 1 : Le bot est mentionné dans un canal public ou privé (@RnF Bot ...)
slackApp.event('app_mention', async ({ event, client }) => {
  console.log(`[Slack] Mention reçue dans le canal ${event.channel} par ${event.user}`);
  await handleUserMessage({
    client,
    channel: event.channel,
    text: event.text,
    threadTs: event.thread_ts,
    messageTs: event.ts
  });
});

// Événement 2 : Message privé en 1-à-1 avec le bot (DM)
slackApp.message(async ({ message, client }) => {
  // Ignorer les messages systèmes, messages de bot ou modifications
  if (message.subtype || message.bot_id) return;

  // Traiter uniquement si c'est un message direct (canal 'im')
  if (message.channel_type === 'im') {
    console.log(`[Slack] Message privé reçu de l'utilisateur ${message.user}`);
    await handleUserMessage({
      client,
      channel: message.channel,
      text: message.text,
      threadTs: message.thread_ts,
      messageTs: message.ts
    });
  }
});

// ==============================================================================
// 5. DÉMARRAGE DU BOT
// ==============================================================================
(async () => {
  try {
    await slackApp.start();
    console.log('⚡️ Le bot Slack RnF est démarré avec succès en Socket Mode !');
    console.log(`🤖 Modèle Gemini actif : ${getModelName()}`);
    console.log('📚 Connecteur Notion : Actif');
    console.log('🔍 Recherche Web Google Search : Active');
  } catch (error) {
    console.error('❌ Erreur critique lors du démarrage du bot Slack :', error);
  }
})();

// Gestion propre de l'arrêt
const shutdown = () => {
  console.log('\n🛑 Arrêt du bot en cours...');
  healthServer.close(() => {
    console.log('Serveur HTTP arrêté.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
