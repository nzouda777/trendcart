# Variables d'environnement de production (Vercel)

À remplir dans **Vercel → Settings → Environment Variables → Production**. Le domaine utilisé
ci-dessous est `https://usetrendcart.com` : adaptez-le si le domaine de prod change.

Ne commitez jamais ces valeurs. Les secrets de prod doivent être **différents** de ceux du
`.env.local`.

Voir aussi : [operations.md](operations.md) (runbook), [integrations.md](integrations.md)
(comptes fournisseurs), [tiktok-business-app.md](tiktok-business-app.md) (app TikTok Ads).

---

## 1. Obligatoires

Sans ces variables, l'app refuse de démarrer ou des fonctions essentielles échouent.

| Variable | Valeur |
| --- | --- |
| `INTEGRATIONS_MODE` | `live`. En production, l'app refuse de démarrer si elle est absente ou vaut `mock`. |
| `NEXT_PUBLIC_SITE_URL` | `https://usetrendcart.com`, sans slash final. Toutes les URL de redirection OAuth sont construites à partir de cette valeur. |
| `DATABASE_URL` | Chaîne de connexion Neon **pooled** de la base de prod. Les URL `pglite:` sont refusées en prod. |
| `BETTER_AUTH_SECRET` | Nouvelle valeur de 32 caractères ou plus : `openssl rand -base64 32`. La changer déconnecte tout le monde. |
| `ENCRYPTION_KEY` | Clé AES-256-GCM, 32 octets en base64 : `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **À sauvegarder en lieu sûr** : si elle est perdue, tous les tokens chiffrés (Shopify, TikTok) sont perdus. Rotation : voir operations.md. |
| `CRON_SECRET` | Chaîne aléatoire. Vercel Cron l'envoie en `Authorization: Bearer`. Sans elle, les crons répondent 401. |
| `RESEND_API_KEY` | Clé Resend. Sans elle, l'inscription et les invitations échouent. |
| `MAIL_FROM` | Par exemple `Trendcart <no-reply@usetrendcart.com>`, sur un domaine vérifié dans Resend. |

## 2. Shopify

| Variable | Valeur |
| --- | --- |
| `SHOPIFY_API_KEY` | Client ID de l'app publique |
| `SHOPIFY_API_SECRET` | Client secret de l'app publique. Il sert aussi à vérifier les HMAC OAuth et webhooks. |
| `SHOPIFY_API_VERSION` | Laisser vide (valeur par défaut : `2026-10`) |
| `SHOPIFY_THEME_WRITES` | Facultatif. `1` seulement si l'app a le scope `write_themes` et l'exemption Shopify. |

Dans le Shopify Partner Dashboard, l'URL de redirection est
`https://usetrendcart.com/api/shopify/callback`.

## 3. TikTok Ads (création et lancement des pubs)

| Variable | Valeur |
| --- | --- |
| `TIKTOK_APP_ID` | App ID de l'app TikTok API for Business |
| `TIKTOK_APP_SECRET` | Secret de cette app |
| `TIKTOK_SANDBOX` | **`false`**. La valeur par défaut est `true` : les appels partent alors vers le serveur sandbox avec un token de production, et la création de campagne échoue. |

Dans le portail Business API, l'URL de redirection est
`https://usetrendcart.com/api/tiktok/ads/callback`.

Les campagnes sont toujours créées **en pause**. Rien ne dépense avant l'approbation du Gate 4.

## 4. Profil TikTok (optionnel)

Ce n'est pas nécessaire pour lancer des pubs : les annonces utilisent le compte publicitaire, avec
le nom de la marque comme identité. Ces variables servent seulement à publier les vidéos en
organique sur un profil.

| Variable | Valeur |
| --- | --- |
| `TIKTOK_LOGIN_CLIENT_KEY` | Client key de l'app developers.tiktok.com (Login Kit + Content Posting) |
| `TIKTOK_LOGIN_CLIENT_SECRET` | Client secret de cette app |
| `TIKTOK_POSTING_AUDITED` | `false` tant que TikTok n'a pas validé l'audit Content Posting. Les posts restent alors privés. |

Si vous les renseignez, l'URL de redirection est `https://usetrendcart.com/api/tiktok/login/callback`.

## 5. Données TikTok, IA et sourcing

| Variable | Valeur |
| --- | --- |
| `TIKTOK_DATA_PROVIDER` | `scrapecreators` |
| `TIKTOK_DATA_PROVIDER_KEY` | Clé ScrapeCreators (import de lien, vidéos similaires) |
| `GEMINI_API_KEY` | Analyse vidéo et identification du produit |
| `ANTHROPIC_API_KEY` | Rédaction de la page produit (Claude) |
| `SERPAPI_KEY` | Recherche fournisseurs (Google Lens, Shopping, Amazon) |
| `FIRECRAWL_API_KEY` | Extraction des pages produit fournisseurs |
| `AI_MODE` | Laisser vide (même valeur que `INTEGRATIONS_MODE`) ou `live`. Jamais `mock` en prod. |

## 6. Recommandées

| Variable | Pourquoi |
| --- | --- |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Limites de débit et verrous partagés entre instances. Sans elles, chaque instance serverless garde ses propres compteurs. |
| `CJ_API_KEY` | Prix CJ Dropshipping directs (sinon, recherche Google) |
| `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET`, `ALIEXPRESS_TRACKING_ID` | Prix AliExpress directs (sinon, recherche Google) |
| `AI_MONTHLY_CAP_USD` | Plafond IA mensuel par workspace (défaut : `50`) |
| `IMPORT_RATE_LIMIT_PER_HOUR` | Imports par workspace et par heure (défaut : `20`) |

## 7. À laisser vides

| Variable | Raison |
| --- | --- |
| `PIPELINE_ENGINE` | Sur Vercel, la valeur par défaut est `workflow` (Vercel Workflow). |
| `BETTER_AUTH_URL` | Seulement si l'auth tourne sur une autre origine que `NEXT_PUBLIC_SITE_URL` |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Optionnel. Origines supplémentaires (séparées par des virgules) autorisées à appeler l'auth. La variante www / sans www de l'URL de base est déjà acceptée automatiquement. |
| `AI_ANALYSIS_MODEL`, `AI_COMPLIANCE_MODEL`, `AI_COPYWRITING_MODEL` | Les modèles par défaut sont dans `lib/ai/pricing.ts`, et `/app/settings` a priorité sur ces variables. |
| `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`, `SENTRY_DSN` | Le code ne les lit pas encore. |

---

## Crons (`vercel.json`)

Les deux crons tournent toutes les heures, ce qui nécessite **Vercel Pro** (le plan Hobby
n'autorise qu'un cron par jour) :

| Route | Planning | Rôle |
| --- | --- | --- |
| `/api/cron/tiktok-stats` | `5 * * * *` | Stats horaires des campagnes lancées |
| `/api/cron/tiktok-token-refresh` | `15 * * * *` | Rafraîchissement des tokens de profil TikTok |

## Checklist avant le déploiement

- [ ] Toutes les variables des sections 1 à 3 et 5 sont renseignées en Production.
- [ ] `TIKTOK_SANDBOX=false`.
- [ ] `pnpm db:migrate` a été lancé sur la base Neon de prod (avec son `DATABASE_URL`). Vercel ne
      lance pas les migrations.
- [ ] Les URL de redirection Shopify et TikTok Ads correspondent exactement au domaine de prod.
- [ ] Le domaine de `MAIL_FROM` est vérifié dans Resend.
- [ ] `/privacy` et `/terms` sont en ligne et publics, car TikTok et Shopify les vérifient.
- [ ] `ENCRYPTION_KEY` est sauvegardée hors de Vercel.
