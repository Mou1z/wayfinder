import type { Page } from "../../src/index.ts";

// Fernhollow Library, a made-up public library: every page the search can send someone to. The
// provider reads `about` to choose, and word matching uses it too, so it says what the page
// covers in the words a visitor might use. `body` is only for the demo's own pages.

export type LibraryPage = Page & { body: string };

export const PAGES: LibraryPage[] = [
  {
    href: "/",
    title: "Home",
    about: "Fernhollow Library: books, e-books, events, study space and local history for the town",
    body: "Three branches, one card. Try the search box: describe what you need in your own words.",
  },
  {
    href: "/join",
    title: "Join the library",
    about: "Get a free library card, or replace a lost or damaged card; who can join and what to bring",
    body: "Anyone who lives, works or studies in Fernhollow can join for free. Bring something with your address on it.",
  },
  {
    href: "/hours",
    title: "Opening hours and branches",
    about: "When the Central, Riverside and Oakfield branches are open, bank holidays, directions and parking",
    body: "Central is open every day. Riverside and Oakfield close on Sundays and Mondays.",
  },
  {
    href: "/borrowing",
    title: "Borrowing, renewing and returns",
    about: "How many books you can borrow and for how long, renewing online, reserving a book, returning late and overdue fees",
    body: "Borrow up to 15 items for three weeks. Renew online, by phone or at any branch.",
  },
  {
    href: "/ebooks",
    title: "E-books and audiobooks",
    about: "Borrow e-books, audiobooks, magazines and newspapers on a phone, tablet or e-reader with the library app",
    body: "Sign in to the app with your card number and PIN. Nothing to return: loans end by themselves.",
  },
  {
    href: "/children",
    title: "Children and families",
    about: "Story time for under-fives, the summer reading challenge, homework help, craft clubs and things to do with kids at weekends",
    body: "Story time runs at Central on Tuesday and Saturday mornings. Children's cards have no overdue fees.",
  },
  {
    href: "/study",
    title: "Study rooms and computers",
    about: "Book a quiet study room or meeting room, use public computers and Wi-Fi, printing, scanning and photocopying",
    body: "Computers are free for an hour a day. Printing costs 10p a page in black and white.",
  },
  {
    href: "/history",
    title: "Local history archive",
    about: "Old maps, photographs, parish records, old newspapers and family history research about the town",
    body: "The archive at Central holds records going back to 1780. Book a visit to see originals.",
  },
  {
    href: "/access",
    title: "Accessibility",
    about: "Large print and talking books, home delivery for people who can't get to a branch, step-free access and hearing loops",
    body: "All three branches have step-free entrances. Home delivery comes every four weeks.",
  },
  {
    href: "/events",
    title: "Events and talks for adults",
    about: "Author talks, book groups, writing workshops and digital skills classes for adults",
    body: "Book groups meet monthly at every branch. Digital skills classes are free and need no booking.",
  },
  {
    href: "/volunteer",
    title: "Volunteer with us",
    about: "Help at the library: reading buddies for children, home delivery drivers, digital helpers",
    body: "Volunteers give two hours a week or more. We'll train you.",
  },
];
