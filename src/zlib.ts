import * as pako from 'pako'

export interface ZlibProvider {
  deflateRaw: (data: Uint8Array) => Uint8Array
  inflateRaw: (data: Uint8Array) => Uint8Array
}

export const zlib: ZlibProvider = {
  deflateRaw: (data) => pako.deflateRaw(data),
  inflateRaw: (data) => pako.inflateRaw(data)
}
