// Ambient declarations for swagger-ui-dist 5.x, which ships no .d.ts.
// pages/docs.vue lazy-imports the bundle + its CSS; this just satisfies
// the typechecker without pulling in a heavyweight @types package.
declare module 'swagger-ui-dist/swagger-ui-bundle.js' {
  const SwaggerUIBundle: (config: Record<string, unknown>) => unknown
  export default SwaggerUIBundle
}

declare module 'swagger-ui-dist/swagger-ui.css'
