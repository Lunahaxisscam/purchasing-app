// Mock Supabase Client untuk pengujian Form Lapangan -> Draft PR
export function createMockClient() {
  const state = {
    purchase_requests: [],
    pr_items: [],
    approval_steps: [],
    rpcCalls: [],
    lastNextPrNum: 100
  }

  const client = {
    _state: state,
    rpc(fnName, args) {
      state.rpcCalls.push({ fn: fnName, args })
      if (fnName === 'next_pr_number') {
        state.lastNextPrNum += 1
        return Promise.resolve({ data: `PR-${String(state.lastNextPrNum).padStart(3, '0')}`, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
    from(table) {
      return {
        insert(records) {
          const arr = Array.isArray(records) ? records : [records]
          const inserted = arr.map((rec, i) => {
            const item = { id: `${table}_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`, ...rec }
            if (table === 'purchase_requests') {
              state.purchase_requests.push(item)
            } else if (table === 'pr_items') {
              state.pr_items.push(item)
            } else if (table === 'approval_steps') {
              state.approval_steps.push(item)
            }
            return item
          })
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({ data: inserted[0] || null, error: null })
                }
              }
            },
            then(resolve) {
              return Promise.resolve({ data: inserted, error: null }).then(resolve)
            }
          }
        },
        update(patch) {
          return {
            eq(col, val) {
              const target = (state[table] || []).filter(row => row[col] === val)
              target.forEach(row => Object.assign(row, patch))
              return Promise.resolve({ data: target, error: null })
            }
          }
        },
        delete() {
          return {
            eq(col, val) {
              state[table] = (state[table] || []).filter(row => row[col] !== val)
              return Promise.resolve({ data: null, error: null })
            }
          }
        },
        select(cols) {
          return {
            eq(col, val) {
              const rows = (state[table] || []).filter(row => row[col] === val)
              return Promise.resolve({ data: rows, error: null })
            }
          }
        }
      }
    }
  }

  return client
}

export const supabase = createMockClient()
