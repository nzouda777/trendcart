# Créer l'app TikTok API for Business (publicités)

Ce guide explique comment créer l'application **TikTok API for Business (Marketing API)** que
Trendcart utilise pour connecter les comptes publicitaires et créer les campagnes, groupes
d'annonces et annonces **en pause** (rien n'est lancé sans approbation humaine).

> Ne pas confondre avec l'app **TikTok for Developers** (`developers.tiktok.com`, Login Kit +
> Content Posting API), qui sert à publier sur les profils TikTok. Ce sont deux portails, deux
> apps et deux paires de clés différentes. Voir [integrations.md](integrations.md).

Les libellés du portail TikTok changent souvent : si un nom diffère légèrement, fiez-vous à la
documentation officielle (`business-api.tiktok.com/portal/docs`).

---

## 0. Prérequis

Avant de commencer, ayez sous la main :

| Élément | Valeur pour Trendcart |
| --- | --- |
| Compte TikTok for Business | Un compte sur `ads.tiktok.com` (idéalement avec un Business Center) |
| Nom de l'entreprise | Identique au registre ABN et aux pages légales (`config/site.ts` → `legal`) |
| Site web | `https://usetrendcart.com` |
| Politique de confidentialité | `https://usetrendcart.com/privacy` |
| Conditions d'utilisation | `https://usetrendcart.com/terms` |
| E-mail de contact | Celui de `config/site.ts` → `legal.contactEmail` |
| URL de redirection | `https://usetrendcart.com/api/tiktok/ads/callback` |

Les pages `/privacy` et `/terms` doivent être en ligne et accessibles publiquement : TikTok les
vérifie pendant la revue.

---

## 1. S'inscrire comme développeur

1. Aller sur **https://business-api.tiktok.com/portal** et se connecter avec le compte
   TikTok for Business.
2. Cliquer sur **Become a Developer** (ou **Register**).
3. Remplir le formulaire :
   - **Company name / Business name** : le nom légal exact.
   - **Company website** : `https://usetrendcart.com`.
   - **Business type / Role** : choisir l'option « outil / plateforme tierce pour annonceurs »
     (third-party tool / marketing platform), pas « annonceur direct ».
   - **Description** : voir le texte proposé à l'étape 2.
4. Envoyer. La validation du profil développeur prend en général de 1 à 3 jours ouvrés
   (notification par e-mail).

---

## 2. Créer l'application

Une fois le profil approuvé : **My Apps → Create an App** (ou **Create New**).

### Champs de l'app

| Champ | À renseigner |
| --- | --- |
| **App name** | `Trendcart` |
| **App description** | Texte ci-dessous |
| **Advertiser redirect URL** | `https://usetrendcart.com/api/tiktok/ads/callback` |
| **TikTok account holder redirect URL** | `https://usetrendcart.com/api/tiktok/ads/callback` si le champ est obligatoire. Trendcart n'utilise pas l'autorisation « account holder » : Spark Ads passe par les codes d'autorisation (`tt_video/authorize`) et la publication sur les profils par l'app Login Kit (`developers.tiktok.com`). |
| **Scope of permission** | Voir la section 3 |

Pour le développement local, ajoutez aussi une URL de redirection vers votre tunnel (ex.
`https://<votre-tunnel>/api/tiktok/ads/callback`) si le portail accepte plusieurs URL ; sinon,
créez une seconde app de test. TikTok exige une correspondance exacte.

### Description proposée (en anglais, langue de la revue)

> Trendcart is a SaaS tool for e-commerce operators. After an advertiser authorizes their ad
> account, Trendcart creates campaigns, ad groups and ads in TikTok Ads Manager, always in a
> PAUSED state. Nothing is launched without an explicit approval by a human user of the
> workspace. Trendcart uploads the approved ad videos and images, uses Spark Ads authorization
> codes when the advertiser provides them, and reads hourly reporting data (spend, impressions,
> clicks, conversions) to display campaign performance. Access tokens are encrypted at rest
> (AES-256-GCM) and every sensitive action is recorded in an audit log.

Ne mentionnez aucune fonctionnalité qui n'existe pas (pas d'automatisation de likes, pas
d'autres réseaux).

---

## 3. Choisir les permissions (scopes)

Trendcart ne demande pas les scopes dans l'URL : ils sont définis **sur l'app** dans le portail.
Cochez les catégories qui couvrent les endpoints utilisés par
`lib/integrations/tiktok-ads/live.ts` :

| Catégorie dans le portail | Endpoints Trendcart couverts | Pourquoi |
| --- | --- | --- |
| **Ad Account Management** | `oauth2/advertiser/get`, `advertiser/info` | Lister les comptes autorisés, devise, fuseau horaire |
| **Ads Management** | `campaign/*`, `adgroup/*`, `ad/*` (create, get, update, status/update) | Créer la campagne en pause, puis la lancer après approbation |
| **Creative Management** | `file/video/ad/upload`, `file/video/ad/info`, `file/image/ad/upload`, `identity/create`, `identity/get` | Envoyer les vidéos (par URL Shopify) et créer l'identité de l'annonce |
| **TikTok Creator / Spark Ads** (parfois inclus dans Creative Management) | `tt_video/authorize`, `tt_video/info` | Utiliser les codes Spark Ads |
| **Reporting** | `report/integrated/get` | Statistiques horaires |

Ne cochez que le nécessaire : une app qui demande trop de permissions est plus souvent refusée.

---

## 4. Soumettre et attendre la revue

1. Vérifier que les URL du site, de la politique de confidentialité et des conditions répondent.
2. Cliquer sur **Submit** / **Submit for review**.
3. La revue prend en général de 2 à 5 jours ouvrés. En cas de refus, TikTok indique la raison
   par e-mail : corrigez puis resoumettez.

Une fois l'app approuvée, la page de l'app affiche :

- **App ID** → `TIKTOK_APP_ID`
- **Secret** → `TIKTOK_APP_SECRET`
- **Advertiser authorization URL** (le lien `https://business-api.tiktok.com/portal/auth?app_id=…`).
  Trendcart construit ce lien lui-même dans `app/api/tiktok/ads/connect/route.ts` : vous n'avez
  rien à copier.

---

## 5. Configurer Trendcart

Dans `.env.local` (local) et dans les variables d'environnement Vercel (production) :

```bash
TIKTOK_APP_ID=<App ID>
TIKTOK_APP_SECRET=<Secret>
# true = appels API vers le sandbox ; false = vrais comptes publicitaires
TIKTOK_SANDBOX=true
INTEGRATIONS_MODE=live
```

Ne commitez jamais ces valeurs. Le secret n'est utilisé que côté serveur.

---

## 6. Tester avec le sandbox

1. Dans le portail, ouvrir l'app → **Sandbox** → créer un **sandbox ad account**.
2. TikTok génère un **advertiser ID** et un **access token** de sandbox directement dans le portail
   (le sandbox n'a pas de flux d'autorisation OAuth).
3. Avec `TIKTOK_SANDBOX=true`, Trendcart envoie tous les appels sauf OAuth vers
   `https://sandbox-ads.tiktok.com/open_api/v1.3`.

> Limite actuelle : Trendcart n'a pas encore d'écran pour coller ce token de sandbox (question
> ouverte notée dans [integrations.md](integrations.md)). En attendant, testez en
> `INTEGRATIONS_MODE=mock`, ou connectez un vrai compte publicitaire avec
> `TIKTOK_SANDBOX=false` : les campagnes sont créées **en pause**, donc aucune dépense tant que
> personne ne les lance.

---

## 7. Connecter un compte publicitaire (production)

1. Dans Trendcart : **Brand → Connections → Connect TikTok ad account** (rôle `owner`).
2. Trendcart redirige vers `business-api.tiktok.com/portal/auth` avec un `state` à usage unique.
3. L'annonceur se connecte et coche les comptes publicitaires à autoriser.
4. TikTok redirige vers `/api/tiktok/ads/callback?auth_code=…&state=…`. Trendcart vérifie le
   `state`, échange l'`auth_code` contre un token longue durée, le chiffre et enregistre une
   `tiktok_ad_connection` par compte autorisé (avec une entrée dans l'audit log).

Les tokens Marketing API sont longue durée et ne sont pas rafraîchis par le cron. Si un annonceur
révoque l'accès, il faut reconnecter le compte.

---

## 8. Checklist

- [ ] Profil développeur approuvé sur `business-api.tiktok.com/portal`
- [ ] App créée avec l'URL de redirection exacte `/api/tiktok/ads/callback`
- [ ] Scopes : Ad Account Management, Ads Management, Creative Management (+ Spark Ads), Reporting
- [ ] App approuvée par TikTok
- [ ] `TIKTOK_APP_ID` et `TIKTOK_APP_SECRET` définis en local et sur Vercel
- [ ] `TIKTOK_SANDBOX` réglé selon l'environnement
- [ ] Premier compte publicitaire connecté et visible dans la marque

## Erreurs fréquentes

| Symptôme | Cause probable |
| --- | --- |
| « redirect_uri mismatch » / page d'erreur TikTok après autorisation | L'URL enregistrée sur l'app ne correspond pas exactement (http/https, slash final, domaine) |
| Code 40001 / « No permission » sur un endpoint | Le scope correspondant n'est pas coché ou pas encore approuvé |
| Aucun compte listé après connexion | L'annonceur n'a coché aucun compte, ou n'a pas le rôle admin/opérateur sur le compte |
| « This connection was started from another session » | Le flux a été lancé depuis un autre navigateur ou une autre session : recommencer |
| Appels qui échouent en sandbox avec un token de production | `TIKTOK_SANDBOX=true` alors que le compte connecté est réel |
