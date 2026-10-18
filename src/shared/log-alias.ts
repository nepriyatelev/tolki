// Pseudonyms for the logs (#106): every process writes the same ones, so the organizer's and a
// participant's logs can be read side by side — and nobody's name is in them.

/** «участник 3f2a»: the first characters of a peer id, random per join. */
export function peerAlias(peerId: string): string {
  return `участник ${peerId.slice(0, 4)}`
}

/** «комната 7k2q»: the first characters of the room id from the invite; «комната» without one. */
export function roomAlias(roomId: string): string {
  return roomId ? `комната ${roomId.slice(0, 4)}` : 'комната'
}
