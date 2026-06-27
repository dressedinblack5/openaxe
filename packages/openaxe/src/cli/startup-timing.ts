// ponytail: simple stderr timer — gate behind OPENAXE_STARTUP_TIMING.
const marks: [string, number][] | null = process.env.OPENAXE_STARTUP_TIMING ? [] : null

export function mark(label: string) {
  if (!marks) return
  const now = performance.now()
  if (marks.length === 0) {
    marks.push([label, now])
    console.error(`[TIMING] ${label}`)
    return
  }
  const prev = marks.at(-1)![1]
  const total = now - marks[0][1]
  marks.push([label, now])
  console.error(`[TIMING] ${label}: +${(now - prev).toFixed(0)}ms (total: ${total.toFixed(0)}ms)`)
}

export function report() {
  if (!marks) return
  const total = marks.at(-1)![1] - marks[0][1]
  console.error(`[TIMING] === ${marks[0][0]} → ${marks.at(-1)![0]}: ${total.toFixed(0)}ms ===`)
}
