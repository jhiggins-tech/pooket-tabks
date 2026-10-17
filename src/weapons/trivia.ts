/**
 * garyoldmancorp's 007 (game/bond.ts): the Bond trivia. Every answer is one of the six actors who played
 * James Bond in the Eon films, and the choices are always all six, in the order they took the role. Keep
 * every question checked and unambiguous: one actor, and only one, fits it.
 */

/** The Bond actors, in the order they took the role: the quiz's six choices. */
export const BOND_ACTORS = ['Sean Connery', 'George Lazenby', 'Roger Moore', 'Timothy Dalton', 'Pierce Brosnan', 'Daniel Craig'] as const;

export type BondActor = (typeof BOND_ACTORS)[number];

export interface BondQuestion {
  q: string;
  answer: BondActor;
}

export const BOND_TRIVIA: readonly BondQuestion[] = [
  { q: 'Which Bond first said “Bond. James Bond.” across a chemin de fer table, in Dr. No (1962)?', answer: 'Sean Connery' },
  { q: 'Which Bond was strapped to a table under an industrial laser and told “No, Mr. Bond, I expect you to die!”?', answer: 'Sean Connery' },
  { q: 'Which Bond flew a Bell rocket belt (a jetpack) in the opening of Thunderball (1965)?', answer: 'Sean Connery' },
  { q: 'Which Bond came back for Never Say Never Again (1983), the film made outside the Eon series?', answer: 'Sean Connery' },
  { q: 'Which Bond broke the fourth wall in his first scene: “This never happened to the other fellow”?', answer: 'George Lazenby' },
  { q: 'Which Bond married Tracy di Vicenzo, only for her to be shot dead on their wedding day?', answer: 'George Lazenby' },
  { q: 'Which actor played Bond in the most Eon films: seven, from Live and Let Die to A View to a Kill?', answer: 'Roger Moore' },
  { q: 'Which Bond went into orbit, to Drax’s space station, in Moonraker (1979)?', answer: 'Roger Moore' },
  { q: 'Which Bond drove the white Lotus Esprit that turned into a submarine in The Spy Who Loved Me (1977)?', answer: 'Roger Moore' },
  { q: 'Which Bond faced Richard Kiel’s steel-toothed Jaws in two films?', answer: 'Roger Moore' },
  { q: 'Which Bond went rogue to avenge Felix Leiter, fed to a shark, in Licence to Kill (1989)?', answer: 'Timothy Dalton' },
  { q: 'Which Bond escaped down a snowy slope riding a cello case in The Living Daylights (1987)?', answer: 'Timothy Dalton' },
  { q: 'Which Bond was up against a young Benicio del Toro as the henchman Dario?', answer: 'Timothy Dalton' },
  { q: 'Which Bond chased General Ourumov through St Petersburg in a tank, in GoldenEye (1995)?', answer: 'Pierce Brosnan' },
  { q: 'Which Bond drove a BMW 750iL by remote control, from the back seat with his phone, in Tomorrow Never Dies (1997)?', answer: 'Pierce Brosnan' },
  { q: 'Which Bond had an Aston Martin Vanquish that could turn invisible, in Die Another Day (2002)?', answer: 'Pierce Brosnan' },
  { q: 'Which Bond chased a bomb-maker up a building crane in Madagascar in his first film?', answer: 'Daniel Craig' },
  { q: 'Which Bond escorted Queen Elizabeth II to the London 2012 Olympics opening ceremony, in a short film?', answer: 'Daniel Craig' },
  { q: 'Which Bond made his last stand at Skyfall, his childhood home in Scotland?', answer: 'Daniel Craig' },
  { q: 'Which Bond died on Safin’s island under a missile strike at the end of No Time to Die (2021)?', answer: 'Daniel Craig' },
];
