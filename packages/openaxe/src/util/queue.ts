export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T) => void)[] = []
  private readonly maxSize: number
  private readonly pushWaiters: Array<{ resolve: (value: T) => void; reject: (error: Error) => void }> = []
  private closed = false

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize
  }

  push(item: T): boolean {
    if (this.closed) return false
    const resolve = this.resolvers.shift()
    if (resolve) {
      resolve(item)
      return true
    }
    if (this.queue.length >= this.maxSize) {
      return false // Backpressure: queue is full
    }
    this.queue.push(item)
    return true
  }

  async pushWithBackpressure(item: T): Promise<void> {
    if (this.closed) throw new Error("Queue is closed")
    const resolve = this.resolvers.shift()
    if (resolve) {
      resolve(item)
      return
    }
    if (this.queue.length < this.maxSize) {
      this.queue.push(item)
      return
    }
    // Wait for space to become available
    return new Promise((resolve, reject) => {
      this.pushWaiters.push({ resolve: resolve as (value: T) => void, reject })
    })
  }

  async next(): Promise<T> {
    if (this.queue.length > 0) {
      const item = this.queue.shift()!
      // Notify a waiter that space is available
      const waiter = this.pushWaiters.shift()
      if (waiter) waiter.resolve(item)
      return item
    }
    if (this.closed) throw new Error("Queue is closed")
    return new Promise((resolve) => this.resolvers.push(resolve))
  }

  close() {
    this.closed = true
    // Resolve all pending next() calls with error
    for (const resolve of this.resolvers) {
      resolve(undefined as T)
    }
    this.resolvers.length = 0
    // Reject all pending push waiters
    for (const waiter of this.pushWaiters) {
      waiter.reject(new Error("Queue is closed"))
    }
    this.pushWaiters.length = 0
  }

  get size(): number {
    return this.queue.length
  }

  get isFull(): boolean {
    return this.queue.length >= this.maxSize
  }

  get isClosed(): boolean {
    return this.closed
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      try {
        yield await this.next()
      } catch {
        return
      }
    }
  }
}

export async function work<T>(concurrency: number, items: T[], fn: (item: T) => Promise<void>) {
  const pending = [...items]
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const item = pending.pop()
        if (item === undefined) return
        await fn(item)
      }
    }),
  )
}
