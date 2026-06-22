// Vite emits font/asset imports as URL strings.
declare module '*.ttf' {
  const src: string
  export default src
}
