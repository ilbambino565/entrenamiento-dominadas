// Imágenes importadas como módulos (Metro devuelve el identificador del asset).
declare module '*.png' {
  const asset: number;
  export default asset;
}
declare module '*.jpg' {
  const asset: number;
  export default asset;
}
