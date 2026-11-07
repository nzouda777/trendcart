# Proxy par marque : mode mock / live, activation et désactivation

Chaque marque peut avoir un proxy optionnel. Quand il est activé, les requêtes
sortantes de la marque passent par lui au lieu de partir directement du serveur
Trendcart :

- import et lecture des vidéos TikTok (fournisseur de données TikTok) ;
- récupération de la vidéo, de la miniature ou de la page produit pour l'analyse IA
  et le contrôle des règles publicitaires ;
- lecture des pages fournisseurs (sourcing) ;
- lecture de la vidéo source avant son envoi sur Shopify.

Les appels aux API d'IA (Google, Anthropic) partent toujours en direct : aucun site
tiers n'y est lu. Le proxy ne sert qu'aux requêtes réseau. Il ne simule aucun
navigateur.

---

## 1. Passer du mode mock au mode live

Le mode est choisi par des variables d'environnement, lues au démarrage du serveur.

| Variable            | Valeurs         | Effet sur le proxy                                                             |
| ------------------- | --------------- | ------------------------------------------------------------------------------ |
| `INTEGRATIONS_MODE` | `mock` / `live` | Mode par défaut de toutes les intégrations.                                    |
| `AI_MODE`           | `mock` / `live` | Optionnel. Prioritaire pour les adaptateurs en lecture seule, test du proxy compris. Vide = même valeur que `INTEGRATIONS_MODE`. |

### Mode mock (par défaut en local)

```env
INTEGRATIONS_MODE=mock
```

- Aucune requête ne sort du serveur.
- Le bouton **Test proxy** lit quand même la vraie configuration de la marque et
  affiche une réponse simulée :
  - proxy activé → route « Through the proxy », IP fictive `203.0.113.x`
    (toujours la même pour un même hôte) ;
  - pas de proxy ou proxy désactivé → route « Direct », IP fictive `198.51.100.10`.
- Le résultat porte l'étiquette **Simulated (mock mode)**.

Ces IP viennent de plages réservées à la documentation (RFC 5737) et
n'appartiennent à personne.

### Mode live

1. Dans `.env.local` (ou dans les variables du projet Vercel) :

   ```env
   INTEGRATIONS_MODE=live
   ENCRYPTION_KEY=...   # obligatoire : sert à chiffrer et déchiffrer l'URL du proxy
   ```

   Pour tester **seulement** le proxy et l'analyse en réel, sans rien écrire sur
   Shopify ni sur TikTok Ads :

   ```env
   INTEGRATIONS_MODE=mock
   AI_MODE=live
   ```

2. Redémarre le serveur (`pnpm dev`) : le mode n'est lu qu'au démarrage.
3. Le bouton **Test proxy** envoie alors une vraie requête vers
   `https://api.ipify.org`, à travers le proxy s'il est activé. Il affiche l'IP
   publique vue par les sites cibles et la latence mesurée, sans l'étiquette
   « Simulated ».
4. Si le proxy ne répond pas, un message d'erreur apparaît. Vérifie alors l'hôte,
   le port et les identifiants.

> En production Vercel (`VERCEL_ENV=production`), le mode mock est refusé : le
> serveur ne démarre pas sans `INTEGRATIONS_MODE=live`, et `AI_MODE=mock` est
> refusé lui aussi.

Remarque : une URL de proxy enregistrée avec une `ENCRYPTION_KEY` ne peut être
déchiffrée qu'avec cette même clé. Si tu changes de clé, enregistre de nouveau le
proxy.

---

## 2. Ajouter, activer, désactiver ou retirer le proxy

Tout se fait dans **Connections → section Proxy**, pour la marque sélectionnée
dans le sélecteur de marque.

**Qui peut le faire :** les rôles `owner` et `media_buyer`. Les rôles `creative` et
`viewer` voient l'état du proxy mais ne peuvent ni le modifier ni le tester.

### Ajouter un proxy

1. Saisis l'URL dans le champ **Proxy URL**, par exemple :
   - `http://utilisateur:motdepasse@hote:8080`
   - `https://utilisateur:motdepasse@hote:8443`
   - `socks5://utilisateur:motdepasse@hote:1080`
2. Clique sur **Save proxy**. Le proxy est enregistré et **activé** directement.

Règles de validation :

- schémas acceptés : `http`, `https`, `socks5` ;
- l'hôte doit être public : `localhost`, les adresses privées et link-local sont
  refusés.

L'URL complète est chiffrée (AES-256-GCM) avant d'être stockée. L'interface
n'affiche ensuite que `schéma://hote:port`, jamais les identifiants.

### Activer / désactiver

- Utilise l'interrupteur **Enabled / Disabled** à côté de l'hôte du proxy.
- **Désactivé** : le proxy reste enregistré, mais toutes les requêtes de la marque
  partent en direct.
- **Activé** : les requêtes repassent par le proxy.
- La modification s'applique dès l'appel suivant (le proxy est relu juste avant
  chaque requête). Aucun redémarrage n'est nécessaire.

### Remplacer ou retirer

- **Replace proxy** : saisis une nouvelle URL, elle remplace l'ancienne.
- **Remove proxy** : supprime l'URL stockée après confirmation. La marque repasse
  en connexion directe.

### Vérifier

Clique sur **Test proxy** après chaque changement. Le résultat indique :

| Champ                   | Signification                               |
| ----------------------- | ------------------------------------------- |
| Route                   | `Through the proxy (http/socks5)` ou `Direct, no proxy` |
| IP seen by target sites | IP publique vue par les sites contactés      |
| Latency                 | Durée de la requête de test                  |

Chaque ajout, remplacement, activation, désactivation ou suppression est inscrit au
journal d'audit (action `proxy.update`), sans l'URL ni les identifiants.

---

## 3. Récapitulatif rapide

| Je veux…                         | Je fais…                                                        |
| -------------------------------- | --------------------------------------------------------------- |
| Une démo sans réseau             | `INTEGRATIONS_MODE=mock`, puis **Test proxy**                   |
| Un vrai test du proxy seul       | `INTEGRATIONS_MODE=mock` + `AI_MODE=live`, puis redémarrer      |
| Tout en réel                     | `INTEGRATIONS_MODE=live` + `ENCRYPTION_KEY`, puis redémarrer    |
| Couper le proxy temporairement   | Interrupteur sur **Disabled**                                   |
| Le supprimer définitivement      | **Remove proxy**                                                |

## Fichiers concernés

- `lib/integrations/proxy-check/` : test du proxy (`mock.ts`, `live.ts`).
- `lib/integrations/tiktok-data/http.ts` : choix de la route (proxy HTTP, SOCKS5 ou direct).
- `lib/workflows/call-context.ts` : déchiffre le proxy juste avant chaque appel.
- `lib/services/brands.ts` : enregistrer, activer, retirer et tester le proxy.
- `components/app/connections/proxy-panel.tsx` : l'interface.
