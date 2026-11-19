# Hosting and sharing the game

The game is a static site: `npm run build` writes everything to `dist/`, with relative paths,
so it runs from any web server and any folder on it. There is no server code and nothing to
configure at run time. Saves stay in each player's browser (IndexedDB).

## GitHub Pages (the chosen host)

1. Create a repository on GitHub and push this one to it:
   ```sh
   git remote add origin git@github.com:<you>/<repo>.git
   git push -u origin main
   ```
   Pages is free for public repositories. A private repository needs a paid plan for Pages.
2. In the repository's **Settings > Pages**, set **Source** to **GitHub Actions**.
3. Every push to `main` now runs `.github/workflows/pages.yml`: it installs, runs the unit tests,
   builds, and publishes `dist/`. The first run can also be started by hand from the **Actions**
   tab ("Deploy to GitHub Pages", **Run workflow**).
4. The game is then at `https://<you>.github.io/<repo>/`. Send that link.

The workflow does not run the e2e tests (they need a browser and take about ten minutes). Run
`npm run check` and `npm run e2e:prod` locally before pushing to `main`.

## Any other static host

Upload the contents of `dist/` (not the folder itself) to the host. Two things to check:

- `.wasm` files must be served as `application/wasm`. Most hosts do this already; if physics
  fails to start, this is the usual cause.
- It must be served over `https://` (or from `localhost`): browsers keep pointer capture,
  gamepads and storage to secure pages.

For itch.io: zip the contents of `dist/`, upload it as an HTML game, and tick "This file will be
played in the browser". Set the viewport to 1280 x 720 and enable "Fullscreen button".

## On one machine

```sh
npm run build
npx vite preview          # http://localhost:4173
```

Opening `dist/index.html` straight from disk does not work: browsers refuse module scripts and
WebAssembly from `file://` pages.

## What a player needs

A desktop or laptop browser with WebGL 2 and WebAssembly: a recent Chrome, Edge, Firefox or
Safari. Hardware acceleration must be on. A browser without them gets a page saying so instead
of the game. Mouse and keyboard, or a standard gamepad. Phones and tablets are not supported.

## Size

The first visit downloads about 1.6 MB compressed, in 145 files (measured for 0.9.0): the
physics engine's wasm is 0.67 MB of it, the engine and game code 0.36 MB, and the rest the glTF
loader's chunks, models and textures. Later visits come from the browser cache.
`npm run build` prints every file with its compressed size.
