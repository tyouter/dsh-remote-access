/**
 * Type bridge for qrcode/lib/browser (browser-safe entry, no fs).
 * @types/qrcode only declares the main 'qrcode' module; re-export its types
 * so the subpath import type-checks. The runtime shape (toDataURL, etc.)
 * matches the main entry's default export.
 */
declare module 'qrcode/lib/browser' {
  export * from 'qrcode'
  export { default } from 'qrcode'
}
