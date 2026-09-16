# 🤖 RnF Assistant — Bot Slack Intelligent (Gemini + Notion + Web)

> **Projet BUT GEA — Guide complet de déploiement et de passation Zéro-Code.**  
> Ce bot agit comme un coéquipier virtuel supplémentaire pour votre équipe de projet : il peut chercher et synthétiser vos documents **Notion**, effectuer des recherches en direct sur le web via **Google Search**, et vous répondre directement dans vos canaux **Slack**.
>
> 💡 **100 % Gratuit à l'usage et à l'hébergement.**  
> 🎓 **Conçu pour les étudiants non informaticiens : aucune ligne de code ni terminal requis !**

---

## 📋 Table des matières
1. [Fonctionnalités du Bot](#-fonctionnalités-du-bot)
2. [Étape 1 : Obtenir la clé Gemini (Gratuit)](#-étape-1--obtenir-la-clé-gemini-100-gratuit)
3. [Étape 2 : Créer le Bot Slack en 2 minutes (Manifest)](#-étape-2--créer-le-bot-slack-en-2-minutes)
4. [Étape 3 : Connecter l'espace Notion](#-étape-3--connecter-lespace-notion)
5. [Étape 4 : Déploiement 1-Clic sur Render (Hébergement Gratuit)](#-étape-4--déploiement-1-clic-sur-render-hébergement-gratuit)
6. [Comment utiliser le bot dans Slack](#-comment-utiliser-le-bot-dans-slack)
7. [Guide de Reprise pour l'Année Prochaine (Passation Zéro-Code)](#-guide-de-reprise-pour-lannée-prochaine-passation-zéro-code)
8. [Sécurité et Confidentialité](#-sécurité-et-confidentialité)

---

## ✨ Fonctionnalités du Bot

- 🧠 **Intelligence Artificielle Google Gemini** : Analyse vos demandes, comprend le contexte de votre projet et formule des réponses claires et professionnelles.
- 📚 **Connexion directe avec Notion** : Le bot recherche dans vos cours, bases de données, comptes-rendus de réunion et fiches projet pour vous faire des synthèses instantanées. Il peut aussi créer des pages ou ajouter des notes.
- 🔍 **Recherche Web en temps réel (Google Search)** : Il a accès à Internet en direct pour vérifier des actualités, des lois, des chiffres économiques ou des définitions sans quitter Slack.
- 💬 **Réponses structurées et soignées** : Il répond toujours dans les fils de discussion (*threads*) pour garder vos canaux Slack propres et bien organisés.

---

## 🔑 Étape 1 : Obtenir la clé Gemini (100% Gratuit)

Google propose un accès gratuit très généreux à ses modèles d'IA via **Google AI Studio**.

> ⚠️ **IMPORTANT : Ne souscrivez à aucun abonnement payant et n'entrez AUCUNE carte bancaire.** Le plan gratuit (*Free of charge*) est amplement suffisant pour toute l'année universitaire.

1. Rendez-vous sur : **[https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)**.
2. Connectez-vous avec votre compte Google universitaire ou personnel.
3. Cliquez sur le bouton bleu **"Create API key"** (Créer une clé API).
4. Choisissez un projet existant ou laissez Google en créer un automatiquement, puis validez.
5. Une fenêtre s'ouvre avec votre clé qui commence par `AIzaSy...`.
6. Cliquez sur **Copy** et collez-la temporairement dans un bloc-notes. Ce sera votre variable **`GEMINI_API_KEY`**.

---

## 💬 Étape 2 : Créer le Bot Slack en 2 minutes

Grâce au fichier **`slack_manifest.json`** inclus dans ce projet, vous n'avez pas besoin de configurer manuellement les dizaines d'autorisations Slack. Tout se fait automatiquement en 1 clic !

### 1. Créer l'application avec le Manifest
1. Rendez-vous sur le portail développeur de Slack : **[https://api.slack.com/apps](https://api.slack.com/apps)**.
2. Cliquez sur le bouton vert **"Create New App"**.
3. Choisissez l'option **"From an app manifest"**.
4. Sélectionnez votre espace de travail Slack (le Slack de votre groupe de projet) et cliquez sur **Next**.
5. Sélectionnez l'onglet **JSON**, effacez le texte présent et **collez l'intégralité du contenu du fichier `slack_manifest.json`** de ce projet.
6. Cliquez sur **Next**, vérifiez le récapitulatif puis cliquez sur **Create**. Votre application est créée !

### 2. Récupérer les 3 clés Slack nécessaires

#### A. Le Token d'Application (`SLACK_APP_TOKEN`)
1. Dans le menu de gauche, restez sur **"Basic Information"**.
2. Faites défiler la page jusqu'à la section intitulée **"App-Level Tokens"**.
3. Cliquez sur **"Generate Token and Scopes"**.
4. Donnez un nom au token (par exemple : `SocketModeToken`).
5. Cliquez sur **"Add scope"** et sélectionnez **`connections:write`**.
6. Cliquez sur **Generate**.
7. Copiez la clé qui commence par **`xapp-...`** et conservez-la. Ce sera votre variable **`SLACK_APP_TOKEN`**.

#### B. Le Secret de Signature (`SLACK_SIGNING_SECRET`)
1. Toujours sur la page **"Basic Information"**, remontez à la section **"App Credentials"**.
2. À côté de **"Signing Secret"**, cliquez sur **Show**.
3. Copiez cette chaîne de caractères. Ce sera votre variable **`SLACK_SIGNING_SECRET`**.

#### C. Le Token du Bot (`SLACK_BOT_TOKEN`)
1. Dans le menu latéral gauche de Slack, cliquez sur **"Install App"**.
2. Cliquez sur le gros bouton vert **"Install to Workspace"** (Installer sur l'espace de travail).
3. Cliquez sur **"Autoriser"** pour donner au bot les accès dans votre Slack.
4. Une fois validé, copiez le code affiché sous **"Bot User OAuth Token"** qui commence par **`xoxb-...`**. Ce sera votre variable **`SLACK_BOT_TOKEN`**.

---

## 📝 Étape 3 : Connecter l'espace Notion

Pour que le bot puisse lire et modifier vos documents de travail sur Notion, il faut lui créer une intégration et l'inviter sur votre page.

### 1. Créer la clé Notion
1. Rendez-vous sur : **[https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)**.
2. Cliquez sur **"+ New integration"** (Nouvelle intégration).
3. Remplissez le formulaire :
   - **Name** : `RnF Assistant` (ou le nom de votre équipe).
   - **Associated workspace** : Sélectionnez l'espace Notion de votre projet.
   - **Type** : Laissez sélectionné *Internal* (Intégration interne).
4. Cliquez sur **Save** (Enregistrer).
5. Cliquez sur **Show** puis **Copy** sous *Internal Integration Secret* (clé commençant par `ntn_...` ou `secret_...`). Ce sera votre variable **`NOTION_API_KEY`**.

### 2. Inviter le Bot sur votre page Notion (INDISPENSABLE !)
> ⚠️ **Sans cette étape, Notion bloque l'accès par sécurité et le bot ne pourra rien lire.**

1. Ouvrez votre page Notion principale de projet dans votre navigateur ou sur l'application.
2. En haut à droite de la page, cliquez sur les **trois petits points `...`**.
3. Descendez tout en bas du menu et cliquez sur **"Connexions"** (ou *"Connect to"*).
4. Dans la barre de recherche, tapez le nom de l'intégration que vous venez de créer (ex: `RnF Assistant`) et cliquez dessus pour l'ajouter.
5. *(Optionnel mais recommandé)* : Copiez l'identifiant de cette page principale (les 32 caractères à la fin de l'URL de la page) pour la mettre dans **`NOTION_ROOT_PAGE_ID`**.

---

## 🚀 Étape 4 : Déploiement 1-Clic sur Render (Hébergement Gratuit)

Render permet d'héberger votre bot **gratuitement** dans le cloud, sans laisser votre ordinateur allumé et sans taper une seule commande dans un terminal.

1. Rendez-vous sur **[https://render.com](https://render.com)** et créez un compte gratuit (vous pouvez vous connecter avec votre compte GitHub).
2. Cliquez sur le bouton **"New +"** en haut à droite et choisissez **"Blueprint"** (ou "Web Service").
3. Connectez votre compte GitHub et sélectionnez le dépôt de ce projet.
4. Render détecte automatiquement le fichier `render.yaml` et affiche un formulaire avec les variables d'environnement.
5. Remplissez simplement les champs avec vos clés notées aux étapes précédentes :
   - `GEMINI_API_KEY` : Votre clé Gemini (`AIzaSy...`)
   - `GEMINI_MODEL` : Laissez `gemini-3.8-flash` (ou modifiez selon vos envies)
   - `SLACK_BOT_TOKEN` : Votre token bot Slack (`xoxb-...`)
   - `SLACK_APP_TOKEN` : Votre token application Slack (`xapp-...`)
   - `SLACK_SIGNING_SECRET` : Votre signing secret Slack
   - `NOTION_API_KEY` : Votre clé Notion (`ntn_...`)
   - `NOTION_ROOT_PAGE_ID` : L'ID de votre page Notion principale (facultatif)
6. Cliquez sur **"Apply"**.
7. Render compile et démarre le bot automatiquement ! Dès que vous voyez `⚡️ Le bot Slack RnF est démarré avec succès en Socket Mode !` dans les logs, votre bot est vivant et connecté à Slack.

---

## 💡 Comment utiliser le bot dans Slack

### 1. Dans un canal de travail (Canal public ou privé)
1. Invitez le bot dans le canal en tapant : `/invite @RnF Bot`
2. Posez-lui une question en le mentionnant :
   - `@RnF Bot Peux-tu me résumer les décisions prises lors de la dernière réunion enregistrée sur Notion ?`
   - `@RnF Bot Quelles sont les obligations légales de la facturation électronique pour les PME en 2026 ?` (Le bot va chercher sur Google en direct).
   - `@RnF Bot Crée une nouvelle page Notion intitulée "Idées de communication" avec les 3 points suivants : [...]`
3. Le bot réagit avec l'émoji ⏳ pendant qu'il traite la demande, puis répond directement dans le fil de discussion (*thread*) et valide avec un ✅.

### 2. En message privé (1-à-1)
Dans la barre latérale gauche de Slack, dans la section **"Messages directs"**, cliquez sur **RnF Bot**. Vous pouvez lui parler en tête-à-tête sans le mentionner, il vous répondra instantanément.

---

## 🔄 Guide de Reprise pour l'Année Prochaine (Passation Zéro-Code)

Vous reprenez ce projet l'année prochaine pour votre BUT GEA ? **Aucun besoin d'ouvrir un terminal ni de modifier les fichiers de code !**

Voici comment administrer le bot en 3 clics :

### Pour changer de modèle d'IA (ex: passer à un nouveau modèle Gemini) :
1. Rendez-vous sur votre tableau de bord **[Render](https://dashboard.render.com)**.
2. Cliquez sur votre service `bot-slack-gemini-notion`.
3. Dans le menu de gauche, cliquez sur **"Environment"**.
4. Trouvez la ligne **`GEMINI_MODEL`** et remplacez simplement le texte (par exemple `gemini-3.8-flash` ou toute version plus récente).
5. Cliquez sur **"Save Changes"**. Render redémarre le bot automatiquement en 30 secondes avec le nouveau modèle d'IA !

### Pour renouveler une clé d'API (si une clé expire ou change de propriétaire) :
1. Dans le même onglet **"Environment"** sur Render, modifiez la valeur de la clé concernée (`GEMINI_API_KEY`, `NOTION_API_KEY`, etc.).
2. Cliquez sur **"Save Changes"**. C'est terminé !

---

## 🛡️ Sécurité et Confidentialité

- **Fichier `.gitignore` actif** : Les fichiers contenant vos clés réelles (`.env`) sont strictement ignorés par Git et ne seront **JAMAIS** envoyés ou visibles publiquement sur GitHub.
- **Socket Mode sécurisé** : Le bot communique avec Slack via une connexion WebSocket chiffrée sortante. Aucun port public ni URL webhook n'est exposé sur Internet.
- **Accès Notion cloisonné** : Le bot ne peut accéder qu'aux pages Notion sur lesquelles vous l'avez explicitement invité via le menu *"Connexions"*. Vos autres documents personnels restent totalement inaccessibles.

---

*Développé avec soin pour l'équipe du projet BUT GEA.*
