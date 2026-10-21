// r256_next_stub.mjs — stub minimal paket `next/*` untuk probe Node.
export default {}
export const useRouter = () => ({ push() {}, replace() {}, query: {}, pathname: '/' })
export const Head = () => null
export const Script = () => null
export const Image = () => null
export const Link = ({ children }) => children
