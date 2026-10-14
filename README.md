# ReNotion

Un espace de notes personnel par blocs, inspiré de Notion. C'est une app web statique (HTML, CSS et JS, sans dépendances ni étape de build), hébergeable gratuitement sur GitHub Pages.

> Écrit de zéro : aucun code de Notion n'est utilisé.

## Fonctionnalités

- Pages imbriquées à l'infini, arbre dans la barre latérale, fil d'Ariane, favoris
- Éditeur par blocs : texte, titres 1 à 3, listes à puces / numérotées / de tâches, listes dépliantes, citations, encadrés, code, séparateurs, sous-pages
- Menu `/` pour insérer ou transformer un bloc
- Raccourcis Markdown : `#`, `##`, `###`, `-`, `1.`, `[]`, `>`, `"`, ` ``` `, `---`
- Formatage : Ctrl+B / I / U, Ctrl+E (code), Ctrl+Maj+X (barré), Ctrl+K sur une sélection (lien)
- Tab / Maj+Tab pour indenter, glisser-déposer pour réordonner, Ctrl+D pour dupliquer
- Coller du Markdown crée les blocs correspondants
- Recherche plein texte (Ctrl+K), icônes emoji, couvertures, corbeille avec restauration
- Thème clair / sombre / système, pleine largeur, interface adaptée au mobile
- Export / import JSON (sauvegarde), import de fichiers Markdown, export d'une page en Markdown

## Données

Tout est stocké dans le `localStorage` **du navigateur utilisé**. Rien n'est envoyé à un serveur. Conséquences :

- les notes ne se synchronisent pas entre appareils ou navigateurs ;
- vider les données du site efface les notes.

Pense à faire **Paramètres → Exporter (JSON)** régulièrement.

## Lancer en local

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Mise en ligne (GitHub Pages)

1. Fusionner ce code dans `main`.
2. Sur GitHub : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
3. Le workflow `.github/workflows/pages.yml` publie le site à chaque push sur `main`, à l'adresse `https://<utilisateur>.github.io/ReNotion/`.

GitHub Pages sur un dépôt privé nécessite un abonnement GitHub payant. Sinon, rends le dépôt public (tes notes, elles, ne sont pas dans le dépôt) ou dépose ces trois fichiers sur Netlify, Vercel ou Cloudflare Pages.
