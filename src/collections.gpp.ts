// the collections module, written in gpp itself.
//
// keeping these in gpp rather than as native functions means one
// implementation instead of two, and the source doubles as documentation a
// reader can open. it is evaluated once when a program imports `collections`.
//
// each constructor returns an object whose fields are closures over private
// state, so `q.push(1)` mutates the queue the way a method would.

export const COLLECTIONS_SOURCE = `
// --- stack: last in, first out ------------------------------------------

fn stack() {
  let items = []

  return {
    push: fn(value) {
      items = push(items, value)
      return value
    },

    // removes and returns the top, or nil when empty
    pop: fn() {
      if len(items) == 0 {
        return nil
      }
      let top = items[len(items) - 1]
      items = slice(items, 0, len(items) - 1)
      return top
    },

    // the top without removing it
    peek: fn() {
      if len(items) == 0 {
        return nil
      }
      return items[len(items) - 1]
    },

    size: fn() { return len(items) },
    is_empty: fn() { return len(items) == 0 },
    to_array: fn() { return items },
    clear: fn() { items = [] }
  }
}

// --- queue: first in, first out -----------------------------------------

fn queue() {
  let items = []

  return {
    push: fn(value) {
      items = push(items, value)
      return value
    },

    // removes and returns the front, or nil when empty
    pop: fn() {
      if len(items) == 0 {
        return nil
      }
      let front = items[0]
      items = slice(items, 1, len(items))
      return front
    },

    peek: fn() {
      if len(items) == 0 {
        return nil
      }
      return items[0]
    },

    size: fn() { return len(items) },
    is_empty: fn() { return len(items) == 0 },
    to_array: fn() { return items },
    clear: fn() { items = [] }
  }
}

// --- set: unique values -------------------------------------------------

fn set(initial) {
  // an object doubles as the backing store: keys are unique by construction.
  // values are keyed by their string form, and the original is kept alongside
  // so numbers do not come back out as strings.
  let entries = {}
  let count = 0

  fn key_of(value) {
    return type_of(value) + ":" + str(value)
  }

  let api = {
    add: fn(value) {
      let k = key_of(value)
      if entries[k] == nil {
        // wrapped so that storing nil itself is still distinguishable from
        // the key being absent
        entries[k] = {value: value}
        count += 1
      }
      return value
    },

    contains: fn(value) {
      return entries[key_of(value)] != nil
    },

    remove: fn(value) {
      let k = key_of(value)
      if entries[k] == nil {
        return false
      }
      // rebuild without the key, since gpp has no delete
      let rebuilt = {}
      for existing in keys(entries) {
        if existing != k {
          rebuilt[existing] = entries[existing]
        }
      }
      entries = rebuilt
      count -= 1
      return true
    },

    size: fn() { return count },
    is_empty: fn() { return count == 0 },

    // insertion order is not preserved; keys() reflects the backing object
    to_array: fn() {
      let out = []
      for k in keys(entries) {
        out = push(out, entries[k].value)
      }
      return out
    },
    clear: fn() {
      entries = {}
      count = 0
    }
  }

  for value in initial {
    api.add(value)
  }

  return api
}

// --- map: keys of any type ----------------------------------------------

fn map_new(initial) {
  // gpp objects already key by string. this adds non-string keys by storing
  // the original key beside its value.
  let entries = {}
  let count = 0

  fn key_of(key) {
    return type_of(key) + ":" + str(key)
  }

  let api = {
    set: fn(key, value) {
      let k = key_of(key)
      if entries[k] == nil {
        count += 1
      }
      entries[k] = {key: key, value: value}
      return value
    },

    // the stored value, or nil when absent
    get: fn(key) {
      let entry = entries[key_of(key)]
      if entry == nil {
        return nil
      }
      return entry.value
    },

    has: fn(key) {
      return entries[key_of(key)] != nil
    },

    remove: fn(key) {
      let k = key_of(key)
      if entries[k] == nil {
        return false
      }
      let rebuilt = {}
      for existing in keys(entries) {
        if existing != k {
          rebuilt[existing] = entries[existing]
        }
      }
      entries = rebuilt
      count -= 1
      return true
    },

    size: fn() { return count },
    is_empty: fn() { return count == 0 },

    keys: fn() {
      let out = []
      for k in keys(entries) {
        out = push(out, entries[k].key)
      }
      return out
    },

    values: fn() {
      let out = []
      for k in keys(entries) {
        out = push(out, entries[k].value)
      }
      return out
    },

    // each entry as {key, value}
    entries: fn() {
      let out = []
      for k in keys(entries) {
        out = push(out, entries[k])
      }
      return out
    },

    clear: fn() {
      entries = {}
      count = 0
    }
  }

  for pair in initial {
    api.set(pair[0], pair[1])
  }

  return api
}

// --- linked list: nodes with a next pointer -----------------------------

fn linked_list() {
  // a node is {value, next}; next is nil at the tail
  let head = nil
  let tail = nil
  let count = 0

  let api = {
    // appends to the tail, which stays O(1) because the tail is tracked
    push: fn(value) {
      let node = {value: value, next: nil}
      if head == nil {
        head = node
        tail = node
      } else {
        tail.next = node
        tail = node
      }
      count += 1
      return value
    },

    prepend: fn(value) {
      let node = {value: value, next: head}
      head = node
      if tail == nil {
        tail = node
      }
      count += 1
      return value
    },

    // removes and returns the head, or nil when empty
    shift: fn() {
      if head == nil {
        return nil
      }
      let value = head.value
      head = head.next
      if head == nil {
        tail = nil
      }
      count -= 1
      return value
    },

    first: fn() {
      if head == nil {
        return nil
      }
      return head.value
    },

    last: fn() {
      if tail == nil {
        return nil
      }
      return tail.value
    },

    contains: fn(value) {
      let node = head
      while node != nil {
        if node.value == value {
          return true
        }
        node = node.next
      }
      return false
    },

    remove: fn(value) {
      let previous = nil
      let node = head

      while node != nil {
        if node.value == value {
          if previous == nil {
            head = node.next
          } else {
            previous.next = node.next
          }
          if node == tail {
            tail = previous
          }
          count -= 1
          return true
        }
        previous = node
        node = node.next
      }

      return false
    },

    size: fn() { return count },
    is_empty: fn() { return count == 0 },

    to_array: fn() {
      let out = []
      let node = head
      while node != nil {
        out = push(out, node.value)
        node = node.next
      }
      return out
    },

    reverse: fn() {
      let previous = nil
      let node = head
      tail = head
      while node != nil {
        let next = node.next
        node.next = previous
        previous = node
        node = next
      }
      head = previous
    },

    clear: fn() {
      head = nil
      tail = nil
      count = 0
    }
  }

  return api
}

// --- priority queue: smallest priority first ----------------------------

fn priority_queue() {
  // a sorted array keeps this short. a binary heap would be faster, but the
  // linear insert is clearer and fine at playground sizes.
  let items = []

  return {
    push: fn(value, priority) {
      let entry = {value: value, priority: priority}
      let out = []
      let inserted = false

      for existing in items {
        if !inserted && priority < existing.priority {
          out = push(out, entry)
          inserted = true
        }
        out = push(out, existing)
      }

      if !inserted {
        out = push(out, entry)
      }

      items = out
      return value
    },

    // removes and returns the lowest priority value, or nil when empty
    pop: fn() {
      if len(items) == 0 {
        return nil
      }
      let front = items[0]
      items = slice(items, 1, len(items))
      return front.value
    },

    peek: fn() {
      if len(items) == 0 {
        return nil
      }
      return items[0].value
    },

    size: fn() { return len(items) },
    is_empty: fn() { return len(items) == 0 }
  }
}
`;

// the names the module exports. `map` would shadow the prelude's map, so the
// constructor is `map_new` internally and exported under both spellings.
export const COLLECTIONS_EXPORTS = [
  "stack",
  "queue",
  "set",
  "linked_list",
  "priority_queue",
];
