# Deployment Guide

## Testing Locally (Before Deploying)

1. **Start the local preview server:**

   ```bash
   ./preview.sh
   ```

   Or specify a custom port:

   ```bash
   ./preview.sh 3000
   ```

2. **Test in your browser:**
   - Main site: http://localhost:8000/
   - Demo site: http://localhost:8000/docs/
3. **Verify:**
   - [ ] Navigation menu shows all links including "Demo"
   - [ ] Click "Demo" link → should load the AI Scientist visualization
   - [ ] All pages load correctly
   - [ ] No broken links

## Deploying to GitHub Pages

### One-Time Setup

Verify GitHub Pages is configured (should already be set):

1. Go to: https://github.com/imichaelen/imichaelen.github.io/settings/pages
2. Confirm settings:
   - **Source**: Deploy from a branch
   - **Branch**: `master` (or `main`)
   - **Folder**: `/ (root)`

### Deploy Changes

```bash
# 1. Add all changes
git add .

# 2. Commit with a descriptive message
git commit -m "Migrate from Gridea, integrate docs demo site"

# 3. Push to GitHub
git push origin master

# 4. Wait 1-2 minutes for GitHub Pages to rebuild

# 5. Visit your site
open https://imichaelen.github.io
```

### Verify Deployment

After pushing:

1. **Check main site**: https://imichaelen.github.io

   - Verify navigation includes "Demo" link
   - Check footer (should NOT say "Powered by Gridea")

2. **Check demo site**: https://imichaelen.github.io/docs/

   - Should show "Autonomous Research Workflow" visualization
   - Interactive tree should load and be scrollable
   - Timelines should display

3. **Check GitHub Pages status**:
   - Go to: https://github.com/imichaelen/imichaelen.github.io/deployments
   - Look for latest deployment (should show "Active")

## Troubleshooting

### Demo site shows 404

- Check that `/docs/` folder exists in your repository
- Verify `docs/index.html` exists
- Clear browser cache and try again

### Changes not appearing

- Wait 2-3 minutes (GitHub Pages needs time to rebuild)
- Check GitHub Actions: https://github.com/imichaelen/imichaelen.github.io/actions
- Force refresh browser: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)

### Demo site links broken

- Ensure demo site uses relative paths (should already be set)
- Links in docs should start with `assets/` not `/assets/`

## Future Updates

### Update main blog content

1. Edit HTML files in `/post/`, `/archives/`, etc.
2. Test locally with `./preview.sh`
3. Deploy: `git add . && git commit -m "msg" && git push`

### Update demo site

1. Edit files in `/docs/`
2. Test locally: `./preview.sh` → http://localhost:8000/docs/
3. Deploy: `git add . && git commit -m "msg" && git push`

## Quick Commands Cheat Sheet

```bash
# Preview locally
./preview.sh

# Deploy changes
git add .
git commit -m "Your update message"
git push origin master

# Check what changed
git status
git diff

# View deployment status
open https://github.com/imichaelen/imichaelen.github.io/deployments
```
