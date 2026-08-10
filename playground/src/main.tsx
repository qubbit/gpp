import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import './index.css'
import App from './App.tsx'

// import the editor core rather than `monaco-editor`, whose barrel drags in
// the typescript, json, html and css language services. gpp supplies its own
// tokenizer, so none of those are wanted and they dominate the bundle.
import * as monaco from 'monaco-editor/editor/editor.api'

// the features the playground actually uses
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js'
import 'monaco-editor/editor/contrib/comment/browser/comment.js'
import 'monaco-editor/editor/contrib/find/browser/findController.js'
import 'monaco-editor/editor/contrib/folding/browser/folding.js'
import 'monaco-editor/editor/contrib/indentation/browser/indentation.js'
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js'
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js'

// bundle monaco rather than pulling it from a cdn at runtime, so the
// playground works offline and ships no third party requests
self.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
}
loader.config({ monaco })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
