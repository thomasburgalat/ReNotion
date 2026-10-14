# ReNotion

Un espace de notes par blocs inspiré de Notion, écrit de zéro (aucun code de Notion). On peut l'utiliser à plusieurs en temps réel, et il intègre un assistant IA (Groq).

**En ligne :** https://renotion-mu.vercel.app

## Fonctionnalités

- Pages imbriquées et **dossiers** (vue en cartes), arbre dans la barre latérale avec **glisser-déposer** (dans un dossier, avant ou après une page), fil d'Ariane, favoris (propres à chaque personne)
- Éditeur par blocs : texte, titres 1 à 3, listes à puces / numérotées / de tâches, listes dépliantes, citations, encadrés, code, séparateurs, sous-pages, **tableaux**
- Tableaux : Tab / Entrée pour naviguer, ＋ pour ajouter lignes et colonnes, clic droit pour insérer, supprimer, trier ou définir les en-têtes ; coller depuis un tableur ou du Markdown remplit les cellules
- Menu `/`, raccourcis Markdown (`#`, `-`, `1.`, `[]`, `>`, `"`, ` ``` `, `---`), glisser-déposer, Tab / Maj+Tab
- Coller du Markdown crée les blocs correspondants
- Recherche plein texte (Ctrl+K), icônes, couvertures, corbeille, thème clair / sombre, mobile
- **Collaboration en direct** : les modifications apparaissent chez les autres en moins d'une seconde ; avatars des personnes connectées et indicateur « X édite ce bloc »
- **IA** (Ctrl+J, `/ia` ou bouton ✨) : améliorer, corriger, raccourcir, développer, traduire, changer le ton, résumer la page, continuer à écrire, extraire les tâches, brainstormer, créer un tableau, ou demande libre. Sur un tableau : remplir les cellules vides, ajouter des lignes ou une colonne, corriger, traduire, résumer. Le résultat peut être inséré ou remplacer le texte.
- **Annuler / Rétablir** (Ctrl+Z, Ctrl+Maj+Z ou ↶ ↷) : propre à chaque personne, n'annule que ses propres modifications même quand d'autres éditent la même page
- **Historique des versions** (menu ⋯ → Historique) : versions automatiques pendant l'édition (au plus toutes les 5 min, plus l'état d'avant tes modifications), aperçu, auteur, restauration annulable ; 100 versions gardées par page
- Export / import JSON, import de fichiers Markdown, export d'une page en Markdown

## Architecture

```
public/              site statique servi par Vercel (aucune étape de build)
  index.html, styles.css
  app.js             éditeur et interface
  cloud.js           comptes, chargement, synchronisation, présence (Supabase)
  ai.js              panneau IA
  config.js          URL Supabase + clé « publishable » (publique par conception)
  vendor/            supabase-js 2.116.0
supabase/
  migrations/        schéma : workspaces, members, pages, blocks + RLS
  functions/signup   inscription par pseudo + code d'invitation (sans e-mail)
  functions/ai       proxy vers Groq, réservé aux membres, en streaming
```

- Un tableau est un bloc dont les cellules sont stockées dans `props.rows` ; quand deux personnes modifient des cellules différentes du même tableau, les changements sont fusionnés cellule par cellule.
- Chaque bloc est une ligne en base, avec une position fractionnaire. Deux personnes qui éditent des blocs différents ne se gênent jamais. Sur un même bloc, la dernière frappe envoyée l'emporte.
- Les modifications sont diffusées immédiatement sur un canal Realtime privé `ws:<id>` (accès réservé aux membres via RLS sur `realtime.messages`), puis enregistrées en base. Après une coupure réseau, l'app se resynchronise.
- La clé Groq reste côté serveur (secret de la fonction Edge), jamais dans le navigateur.

## Inviter quelqu'un

Paramètres → **Lien d'invitation** → copier et envoyer. La personne choisit un pseudo et un mot de passe, sans e-mail. Le propriétaire de l'espace peut régénérer le lien.

## Configuration de l'IA

Ajouter le secret `GROQ_API_KEY` (clé créée sur https://console.groq.com/keys) dans Supabase → Edge Functions → Secrets. Le secret optionnel `GROQ_MODEL` force un modèle ; sinon la fonction choisit automatiquement un modèle disponible (gpt-oss-120b, llama-3.3-70b…).

## Développement local

```bash
cd public && python3 -m http.server 8000
```

Pour un mode 100 % local (sans compte, données dans le navigateur), vider `supabaseUrl` dans `public/config.js`.
