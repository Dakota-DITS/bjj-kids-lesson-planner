/* Built-in coloring sheets parents can open without a login. No student data. */
window.COLORING_SHEETS = [
  { id: "first-gi", name: "My First Gi", theme: "First class", title: "My First Gi!", src: "/sheets/first-gi.png?v=3", baked: true },
  { id: "bow", name: "I Can Bow", theme: "First class", title: "I Can Bow!", src: "/sheets/bow.png?v=3", questions: ["When we come on the mat, we", "We bow on the"] },
  { id: "high-five", name: "High-Five", theme: "First class", title: "High-Five!", src: "/sheets/high-five.png?v=6", questions: ["At the end we", "This is a", "This is my"] },
  { id: "bear-crawl", name: "Bear Crawl", theme: "Movement", title: "Bear Crawl!", src: "/sheets/bear-crawl.png?v=6", questions: ["Crawl like a", "Hands and", "Stay on the"] },
  { id: "ninja", name: "Ninja Freeze", theme: "Movement", title: "Ninja Freeze!", src: "/sheets/ninja.png?v=6", questions: ["Stand like a", "Feet", "Hands at your"] },
  { id: "burrito", name: "Roll Like a Burrito", theme: "Movement", title: "Roll Like a Burrito!", src: "/sheets/burrito.png?v=5", questions: ["Roll like a", "This is my", "Roll on the"] },
  { id: "donuts", name: "Grab the Donuts", theme: "Movement", title: "Grab the Donuts!", src: "/sheets/donuts.png?v=3", questions: ["These are", "Grab one", "Crawl like a"] },
  { id: "frog", name: "Frog Guard", theme: "Guard", title: "Frog Guard!", src: "/sheets/frog.png?v=3", questions: ["Sit like a", "Feet", "This is"] },
  { id: "guard", name: "Guard", theme: "Guard", title: "Guard!", src: "/sheets/guard.png?v=2", questions: ["This is", "On your", "Feet toward"] },
  { id: "mount", name: "Mount", theme: "Mount", title: "Mount!", src: "/sheets/mount.png?v=3", questions: ["This is", "Who is on", "Don't stay"] },
  { id: "side-control", name: "Side Control", theme: "Side control", title: "Side Control!", src: "/sheets/side-control.png?v=3", questions: ["Get to the", "Chest on", "On your"] },
  { id: "turtle", name: "Turtle", theme: "Turtle", title: "Turtle!", src: "/sheets/turtle.png?v=2", questions: ["This is", "Chin", "Elbows"] },
  { id: "backpack", name: "Back Take", theme: "Back", title: "Back Take!", src: "/sheets/backpack.png?v=2", questions: ["This is", "Stay", "Hold"] },
  {
    id: "comic-bow",
    name: "Comic: Come On the Mat",
    theme: "Comics",
    title: "Come On the Mat!",
    comic: true,
    panels: [
      ["/sheets/comic/bow-1.png?v=1", "Line up!"],
      ["/sheets/comic/bow-2.png?v=1", "We bow!"],
      ["/sheets/comic/bow-3.png?v=1", "Come on!"]
    ]
  },
  {
    id: "comic-ninja",
    name: "Comic: Ninja Freeze",
    theme: "Comics",
    title: "Ninja Freeze!",
    comic: true,
    panels: [
      ["/sheets/comic/ninja-1.png?v=1", "Freeze!"],
      ["/sheets/comic/ninja-2.png?v=1", "High-five!"],
      ["/sheets/comic/bow-3.png?v=1", "Good job!"]
    ]
  },
  {
    id: "comic-positions",
    name: "Comic: BJJ Positions",
    theme: "Comics",
    title: "BJJ Positions!",
    comic: true,
    six: true,
    panels: [
      ["/sheets/comic/pos-back-mount.png?v=1", "Back mount"],
      ["/sheets/comic/pos-mount.png?v=1", "Mount"],
      ["/sheets/comic/pos-guard.png?v=1", "Guard"],
      ["/sheets/comic/pos-side.png?v=1", "Side control"],
      ["/sheets/comic/pos-half-guard.png?v=1", "Half guard"],
      ["/sheets/comic/pos-north-south.png?v=1", "North south"]
    ]
  }
];

window.BELT_COLORS = [
  ["", "No belt yet"],
  ["#f4f4f4", "White"],
  ["#d9d9d9", "Grey-white"],
  ["#8a8a8a", "Grey"],
  ["#4a4a4a", "Grey-black"],
  ["#fff3b0", "Yellow-white"],
  ["#f2c200", "Yellow"],
  ["#c9a000", "Yellow-black"],
  ["#ffd7b0", "Orange-white"],
  ["#f08a24", "Orange"],
  ["#c45a10", "Orange-black"],
  ["#d9f5d6", "Green-white"],
  ["#2f9e44", "Green"],
  ["#1f6b32", "Green-black"]
];
