# gpp playground

Write and run gpp in the browser. The editor is Monaco with a gpp tokenizer,
and programs are shared through the url fragment.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
```

The language core is imported straight from `../src`, so there is no build
step between the two: editing the lexer, parser or evaluator is picked up by
the dev server immediately.

`GPP_BASE` overrides the production base path, which defaults to `/gpp/` for
GitHub Pages.
