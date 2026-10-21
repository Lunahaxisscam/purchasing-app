// r256_register.mjs — daftarkan hook resolusi (Node 20+: module.register).
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register(pathToFileURL(new URL('./r256_loader.mjs', import.meta.url).pathname))
