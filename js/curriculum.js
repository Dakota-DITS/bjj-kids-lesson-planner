/* Grace BJJ Kids technique pool. Real positions, escapes, sweeps, passes, and defense. */
(function () {
  const ALL = ["mite", "upper"];
  const OLDER = ["mite", "upper"];
  const BIG = ["upper"];
  const SMALL = ["mite", "upper"];
  const DATA = window.BJJ_DATA;

  DATA.themes = [
    { id: "breakfalls", label: "Breakfalls", position: "Standing", order: 1 },
    { id: "mount", label: "Mount", position: "Mount", order: 2 },
    { id: "side", label: "Side control", position: "Side control", order: 3 },
    { id: "guard", label: "Closed guard", position: "Closed guard", order: 4 },
    { id: "open-guard", label: "Open guard", position: "Open guard", order: 5 },
    { id: "passes", label: "Passes", position: "Open guard", order: 6 },
    { id: "back", label: "Back control", position: "Back control", order: 7 },
    { id: "turtle", label: "Turtle", position: "Turtle", order: 8 },
    { id: "kob", label: "Knee on belly", position: "Knee on belly", order: 9 },
    { id: "takedowns", label: "Takedowns", position: "Standing", order: 10 },
    { id: "defense", label: "Submission defense", position: "Defense", order: 11 },
    { id: "chains", label: "Chains", position: "Chains", order: 12 },
    { id: "sweeps", label: "Sweeps", position: "Sweeps", order: 13 },
  ];
  const themeLabel = Object.fromEntries(DATA.themes.map((theme) => [theme.id, theme.label]));

  function tech(id, theme, order, position, name, ages, steps, drill, safety, extra) {
    const more = extra && typeof extra === "object" ? extra : {};
    const themes = [theme]
      .concat(Array.isArray(more.themes) ? more.themes : [])
      .filter((item, index, list) => item && list.indexOf(item) === index);
    DATA.activities.push({
      id,
      category: "lesson",
      theme,
      themes,
      themeLabel: themeLabel[theme] || theme,
      order,
      position,
      name,
      ages,
      duration: 4,
      reps: 5,
      steps,
      drill: drill || "5 reps each side, then switch partners.",
      safety: safety || "",
      how: steps.join(" "),
      say: more.say || steps[0],
      tags: Array.isArray(more.tags) ? more.tags : [],
    });
  }

  function game(id, name, ages, themes, how, say, extra) {
    DATA.activities.push({
      id,
      category: "game",
      name,
      ages,
      themes,
      duration: 5,
      reps: 1,
      how,
      say,
      extra: extra || "The game closes class. Keep it only if the whole class is listening.",
    });
  }

  tech(
    "ls-bf-back",
    "breakfalls",
    1,
    "Standing",
    "Back breakfall",
    ALL,
    [
      "Tuck your chin to your chest so the back of your head never hits the mat.",
      "Sit down close to your heels and round your back.",
      "Slap the mat with both arms at the same time as you land.",
    ],
    "3 reps down the lane, then switch lines.",
    "Spot Mighty Mites with a hand behind the shoulder. Stop anyone who throws the head back."
  );
  tech(
    "ls-bf-side",
    "breakfalls",
    2,
    "Standing",
    "Side breakfall",
    ALL,
    [
      "Tuck the chin and look at your belt.",
      "Fall to one side and slap the mat with that arm.",
      "Knees stay bent. Sit back up and do the other side.",
    ],
    "3 reps each side, then switch lines.",
    "One lane at a time so nobody falls into a friend."
  );
  tech(
    "ls-tech-stand",
    "breakfalls",
    3,
    "Standing",
    "Technical stand-up",
    ALL,
    [
      "From your back, post one hand on the mat by your ear.",
      "The other foot steps out. Hips up.",
      "Stand tall and bring your hands in front of your face.",
    ],
    "5 reps each side, then switch partners so someone can watch the chin.",
    "Chin stays tucked. If they hop onto the neck, reset and do it slower."
  );
  tech(
    "ls-get-knees",
    "breakfalls",
    4,
    "Standing",
    "Get to your knees",
    SMALL,
    [
      "From your back, turn to one hip.",
      "Bring the bottom knee under you.",
      "Both hands post, then pop up to your knees and look at the teacher.",
    ],
    "5 reps each side. The partner just watches and counts."
  );

  tech(
    "ls-mount-hold",
    "mount",
    1,
    "Mount",
    "Hold mount",
    ALL,
    [
      "Knees squeeze like you are giving a horse a hug.",
      "Hands post on the mat by their shoulders. Hips stay heavy.",
      "If they wiggle, reconnect your knees. Don't put hands on the neck.",
    ],
    "Hold for a slow count of 5, then switch who is on top.",
    "No squeezing the ribs with a forearm. No neck. Mighty Mites keep the toes on the mat."
  );
  tech(
    "ls-upa",
    "mount",
    2,
    "Mount",
    "Bridge and roll (upa)",
    ALL,
    [
      "Trap one of their arms and the same-side foot.",
      "Feet flat, then bridge your hips up like a banana.",
      "Roll toward the trapped arm and land in their guard.",
    ],
    "5 reps each side, then switch partners.",
    "The partner on top lets the roll happen. Nobody posts a hand on a face."
  );
  tech(
    "ls-elbow-knee",
    "mount",
    3,
    "Mount",
    "Elbow-knee escape",
    ALL,
    [
      "Turn to one side and make a frame on their hip.",
      "Shrimp until your bottom knee can sneak inside.",
      "Rebuild closed guard and put your feet together.",
    ],
    "5 reps each side, then switch partners.",
    "Frames stay on the hip and shoulder, never the neck."
  );
  tech(
    "ls-americana",
    "mount",
    4,
    "Mount",
    "Americana from mount",
    OLDER,
    [
      "From mount, pin one wrist to the mat beside their shoulder.",
      "Your other hand grabs your own wrist and makes a grip like a figure four.",
      "Slide their elbow and slowly lift the wrist toward their ear. Stop when they tap.",
    ],
    "3 slow reps each side, then switch partners.",
    "Slow and controlled. Teach the tap first. Let go the instant they tap. No cranking. Mighty Mites do not do this."
  );
  tech(
    "ls-armbar",
    "mount",
    5,
    "Mount",
    "Armbar from mount",
    OLDER,
    [
      "Pin one arm across their face and step the foot on that side up by their head.",
      "Turn your hips and sit back so their arm is on your tummy.",
      "Heels in, knees together, and lift your hips slowly until they tap.",
    ],
    "3 slow reps each side, then switch partners.",
    "Thumb up, slow hips. Let go the instant they tap. The partner keeps the other arm safe. No fast falls."
  );

  tech(
    "ls-side-hold",
    "side",
    1,
    "Side control",
    "Hold side control",
    ALL,
    [
      "Chest on their chest. Hips low.",
      "One arm under the head, the other by the hip, like a seatbelt that is not a choke.",
      "Walk your knees up if they make space. Stay on your toes.",
    ],
    "Hold for a slow count of 5, then switch who is on top.",
    "The head-side arm does not squeeze the neck. No knee on the belly in this drill."
  );
  tech(
    "ls-side-shrimp",
    "side",
    2,
    "Side control",
    "Shrimp out of side control",
    ALL,
    [
      "Frame on the neck-side shoulder and the hip. Elbows stay in.",
      "Feet on the mat and shrimp your hips away.",
      "Turn to your knees or put a knee back in.",
    ],
    "5 reps each side, then switch partners.",
    "The partner on top gives a real hold but does not drop weight on the neck."
  );
  tech(
    "ls-side-knees",
    "side",
    3,
    "Side control",
    "Recover to your knees",
    SMALL,
    [
      "Shrimp once to make a pocket.",
      "Turn all the way to your knees and face them.",
      "Hands up. Look at their chest.",
    ],
    "5 reps each side. Partner counts out loud."
  );
  tech(
    "ls-knee-shield",
    "side",
    4,
    "Side control",
    "Knee shield",
    OLDER,
    [
      "Shrimp and turn toward them.",
      "Put the bottom knee across their hip like a shield.",
      "Both hands frame. Keep the shield until the teacher says switch.",
    ],
    "5 reps each side, then switch partners."
  );

  tech(
    "ls-closed-guard",
    "guard",
    1,
    "Closed guard",
    "Sit in closed guard",
    ALL,
    [
      "On your back, wrap your legs around their waist.",
      "Ankles cross behind them. Knees point to the ceiling.",
      "Hands hold their shoulders or sleeves. Head off the mat if you can.",
    ],
    "Hold for a slow count of 5, then switch.",
    "No ankles locked on the ribs so hard it hurts. Ask before you squeeze."
  );
  tech(
    "ls-posture",
    "guard",
    2,
    "Closed guard",
    "Posture in guard",
    ALL,
    [
      "The partner on top sits tall like a superhero.",
      "Hands on their hips or biceps, not on the mat by their head.",
      "The partner on the bottom keeps ankles crossed and tries to bend them forward. Posture wins if the back stays straight.",
    ],
    "5 tries each, then switch who is on top.",
    "No grabbing the neck to pull them down."
  );
  tech(
    "ls-guard-pull",
    "guard",
    3,
    "Closed guard",
    "Guard pull",
    ALL,
    [
      "Hold a sleeve and a collar, gentle hands.",
      "Put one foot on their hip and sit to your bottom.",
      "Wrap closed guard. Mighty Mites can just sit and connect their feet.",
    ],
    "5 reps each side, then switch partners.",
    "Sit down. Do not jump onto a partner. No falling backward onto the neck."
  );
  tech(
    "ls-scissor-prep",
    "guard",
    3.5,
    "Closed guard",
    "Scissor sweep prep",
    ALL,
    [
      "Open your guard and put one foot on their hip.",
      "Point the other knee toward their opposite shoulder.",
      "Shrimp your hips out to that side until you are on an angle.",
    ],
    "5 reps each side, then go to the scissor sweep.",
    "Stay on your back. Shrimp the hips out. Do not kick. Mighty Mites copy the teacher. No gi grips required.",
    { themes: ["sweeps"], say: "Foot on the hip. Shrimp out to an angle.", tags: ["sweep"] }
  );
  tech(
    "ls-scissor",
    "guard",
    4,
    "Closed guard",
    "Scissor sweep",
    ALL,
    [
      "From closed guard, open and put one foot on the hip.",
      "The other leg chops across their knee like scissors.",
      "Roll them over you and come up in mount. Hold a sleeve if you have one. Mighty Mites can hold the shoulder.",
    ],
    "5 reps each side, then switch partners.",
    "The chop is a push with the shin, not a kick. For Mighty Mites, the teacher does the chop with them, slow, and the partner rolls gently. No gi grips required. Partner taps the mat if they need a reset. Finish in mount.",
    { themes: ["sweeps"], say: "Foot on the hip. Chop like scissors. Roll them over and sit on top.", tags: ["sweep"] }
  );
  tech(
    "ls-hip-bump",
    "guard",
    5,
    "Closed guard",
    "Hip bump sweep",
    OLDER,
    [
      "Open the guard and sit up on one hip.",
      "Post one hand behind you and bump their chest with your hip.",
      "They fall to that side. Follow them and take mount.",
    ],
    "5 reps each side, then switch partners.",
    "Bump the chest, not the face. Sit up only as far as you can without posting on a friend. Finish in mount.",
    { themes: ["sweeps"], tags: ["sweep"] }
  );
  tech(
    "ls-seated-bump",
    "guard",
    5.5,
    "Closed guard",
    "Seated hip bump",
    ALL,
    [
      "Your partner kneels in front of you. You sit and post one hand behind you.",
      "Sit up and bump their hip with your hip.",
      "They tip to that side. Follow them and take mount.",
    ],
    "5 reps each side, then switch partners.",
    "Bump the hip, not the face. The partner is on their knees, so the fall is a small roll. For Mighty Mites the teacher bumps with them. Finish in mount.",
    { themes: ["sweeps"], say: "Sit up, bump the hip, and climb on top.", tags: ["sweep"] }
  );
  tech(
    "ls-flower",
    "guard",
    6,
    "Closed guard",
    "Pendulum (flower) sweep",
    OLDER,
    [
      "Hold one arm across your body.",
      "Swing your legs to the other side like a flower in the wind, then back under them.",
      "The swing tips them over. Come up in mount.",
    ],
    "5 slow reps each side, then switch partners.",
    "Swing small. No kicking the head. Clear the mats beside you before you swing. Finish in mount.",
    { themes: ["sweeps"], tags: ["sweep"] }
  );
  tech(
    "ls-kimura",
    "guard",
    7,
    "Closed guard",
    "Kimura from guard",
    BIG,
    [
      "From closed guard, catch one wrist and turn toward that arm.",
      "Figure-four grip behind their arm. Their thumb points up.",
      "Walk the grip toward their belt slowly until they tap.",
    ],
    "3 slow reps each side, then switch partners.",
    "Slow. Let go the instant they tap. Do not rip the shoulder. 8–10 only."
  );

  tech(
    "ls-feet-hips",
    "open-guard",
    1,
    "Open guard",
    "Feet on hips",
    OLDER,
    [
      "Open your guard and put both feet on their hips.",
      "Knees stay between you and them.",
      "Hands hold sleeves. Push just enough to keep them from falling on you.",
    ],
    "Hold for a slow count of 5, then switch.",
    "Toes and heels push the hips, not the stomach hard enough to knock the wind out."
  );
  tech(
    "ls-open-standup",
    "open-guard",
    2,
    "Open guard",
    "Stand up in open guard",
    OLDER,
    [
      "Feet on the hips, then post one hand and shrimp to one hip.",
      "The outside foot steps up.",
      "Stand into a technical stand-up and put your hands up.",
    ],
    "5 reps each side, then switch partners."
  );
  tech(
    "ls-butterfly",
    "open-guard",
    10,
    "Open guard",
    "Butterfly sweep",
    OLDER,
    [
      "Sit up with both butterfly hooks in. Hold their wrists.",
      "Fall to one side and lift that hook so their weight comes onto you.",
      "Roll them over that shoulder and come up in mount.",
    ],
    "5 reps each side, then switch partners.",
    "Lift with the hook into the thigh. Do not kick the knee. The partner rolls with the sweep. Finish in mount.",
    { themes: ["sweeps"], say: "Hooks in. Fall to one side. Lift and come up on top.", tags: ["sweep"] }
  );
  tech(
    "ls-tripod",
    "open-guard",
    11,
    "Open guard",
    "Tripod sweep",
    OLDER,
    [
      "Put one foot on the hip and the other foot behind their knee.",
      "Hold the wrist on the same side as the foot behind the knee.",
      "Push the hip, pull the arm, and chop the back of the knee. Come up on top.",
    ],
    "5 reps each side, then switch partners.",
    "The foot pulls the back of the knee. Do not twist the knee. The partner falls to the open side. Finish on top.",
    { themes: ["sweeps"], say: "Foot on the hip, foot behind the knee. Push, pull, and come up on top.", tags: ["sweep"] }
  );
  tech(
    "ls-sickle",
    "open-guard",
    12,
    "Open guard",
    "Sickle sweep",
    BIG,
    [
      "Hook one foot behind their standing heel, like a sickle.",
      "Keep the other foot on the hip so they cannot step over.",
      "Pull them toward you and scythe that leg so they fall. Come up on top.",
    ],
    "3 slow reps each side, then switch partners.",
    "8–10. The hook takes the heel. Do not twist the knee. If the knee turns, let go. Finish on top.",
    { themes: ["sweeps"], say: "Sickle the heel. Foot on the hip. Pull them down and come up on top.", tags: ["sweep"] }
  );

  tech(
    "ls-knee-slice",
    "passes",
    1,
    "Open guard",
    "Knee-slice pass",
    BIG,
    [
      "From their feet-on-hips, pin one knee to the mat.",
      "Your other knee slices across their thigh like a slow windshield.",
      "Chest follows. End in side control.",
    ],
    "5 reps each side, then switch partners.",
    "Slice the thigh, not the knee joint. Partner taps if the knee twists."
  );
  tech(
    "ls-toreando",
    "passes",
    2,
    "Open guard",
    "Toreando pass",
    BIG,
    [
      "Hold both pants at the knees.",
      "Push the knees to one side and step around the feet.",
      "Turn the corner and land in side control.",
    ],
    "5 reps each side, then switch partners.",
    "No diving onto the legs. Stay standing until you have passed the feet."
  );

  tech(
    "ls-seatbelt",
    "back",
    1,
    "Back control",
    "Seatbelt",
    ALL,
    [
      "Chest on their back. Hooks in, or toes on the mat for Mighty Mites.",
      "One arm over the shoulder, one under the arm, hands clasped on the chest.",
      "Your head stays on the shoulder. You do not squeeze the neck.",
    ],
    "Hold for a slow count of 5, then switch.",
    "This is a hug, not a choke. If anyone touches the neck, stop and reset the hands on the chest."
  );
  tech(
    "ls-back-hide",
    "back",
    2,
    "Back control",
    "Hide your neck",
    ALL,
    [
      "The partner has seatbelt, hands on the chest only.",
      "You tuck your chin and put both hands on your neck like a scarf.",
      "Elbows stay glued to your ribs. Count to 5, then switch.",
    ],
    "5 holds, then switch who is on the back.",
    "No choking in this drill. Hands that slide to the neck come off right away."
  );
  tech(
    "ls-rnc",
    "back",
    3,
    "Back control",
    "Rear naked choke",
    BIG,
    [
      "From the seatbelt, the top arm slides under the chin only when the teacher says so.",
      "The blade of the wrist is on the neck. The other hand holds your own shoulder.",
      "Squeeze slow, like a hug, and let go the instant they tap.",
    ],
    "3 slow reps each side, then switch partners.",
    "8–10 only. Teach the tap first. No squeezing before the tap is practiced. Let go immediately. Stop the room if someone cranks."
  );

  tech(
    "ls-turtle-hold",
    "turtle",
    1,
    "Turtle",
    "Hold turtle",
    ALL,
    [
      "Hands and knees. Elbows in. Chin tucked. Forehead toward the mat but not resting on the neck.",
      "The partner kneels beside you and holds the near hip and the far shoulder.",
      "Stay small for a count of 5.",
    ],
    "Hold for a count of 5, then switch.",
    "No sprawling full weight on a small back. No hands around the neck."
  );
  tech(
    "ls-turtle-peek",
    "turtle",
    2,
    "Turtle",
    "Peek and recover",
    ALL,
    [
      "From turtle, peek under one arm and look at their hip.",
      "Sit toward that peek and put a hook in, or just face them.",
      "End looking at your partner with hands up.",
    ],
    "5 reps each side, then switch partners."
  );

  tech(
    "ls-kob",
    "kob",
    1,
    "Knee on belly",
    "Knee on belly",
    ALL,
    [
      "From side control, put one knee on the tummy, light as a cat.",
      "The other leg posts out wide. Hips face their hips.",
      "Hands post on the mat. Mighty Mites rest the knee on the belt, not the ribs.",
    ],
    "Hold for a slow count of 3, then switch.",
    "Light knee. No bouncing. Take it off the moment they tap or say stop. Spot the Mighty Mites."
  );
  tech(
    "ls-kob-shrimp",
    "kob",
    2,
    "Knee on belly",
    "Shrimp away from knee on belly",
    ALL,
    [
      "Frame on the knee and the shoulder.",
      "Bridge a little, then shrimp your hips out.",
      "Turn to your knees and face them.",
    ],
    "5 reps each side, then switch partners.",
    "The knee stays light while they escape."
  );

  tech(
    "ls-double",
    "takedowns",
    1,
    "Standing",
    "Double-leg",
    OLDER,
    [
      "Level change: bend your knees, back straight, eyes up.",
      "Step in and hug both legs above the knees.",
      "Drive through them and put them down on their side. You land in side control.",
    ],
    "5 reps each side, then switch partners.",
    "They already know the side breakfall. No lifting a partner off the mat. No shots into a wall. One pair at a time if the mat is crowded."
  );
  tech(
    "ls-single",
    "takedowns",
    2,
    "Standing",
    "Single-leg",
    OLDER,
    [
      "Level change and catch one leg.",
      "Head stays on the inside, ear against their ribs.",
      "Step to the side and put them down. Finish in side control.",
    ],
    "5 reps each side, then switch partners.",
    "Hug the thigh, not the knee joint. No swinging them into another pair."
  );
  tech(
    "ls-osoto",
    "takedowns",
    3,
    "Standing",
    "Osoto gari",
    BIG,
    [
      "Same-side collar and sleeve, gentle grips.",
      "Step to the outside and reap their near leg back.",
      "They do a side breakfall. You kneel into side control.",
    ],
    "5 slow reps each side, then switch partners.",
    "8–10 only, and only after breakfalls. No reaping into the knee sideways. Let go if they don't fall clean. One pair at a time."
  );

  tech(
    "ls-hands-in",
    "defense",
    1,
    "Defense",
    "Hands in",
    ALL,
    [
      "Partner reaches for a collar. You do not wait.",
      "Both hands shoot in between their hands and your neck.",
      "Elbows stay tight. Chin down. Hold until they let go.",
    ],
    "5 reps, then switch who is defending.",
    "This is defense, not a submission. Nobody finishes a choke."
  );
  tech(
    "ls-elbows",
    "defense",
    2,
    "Defense",
    "Elbows tight",
    ALL,
    [
      "Hands start on your tummy.",
      "Pull your elbows to your ribs like you are hiding them in your pockets.",
      "If they reach under an elbow, glue it back down.",
    ],
    "5 reps each side, then switch partners.",
    "No prying an elbow up to hunt an armbar. The drill is the defense."
  );
  tech(
    "ls-neck-defense",
    "defense",
    3,
    "Defense",
    "Protect the neck",
    ALL,
    [
      "Chin to chest.",
      "One hand covers the front of the neck. The other grabs their wrist.",
      "Turn your face toward the elbow and make space. Tell the teacher when you need help.",
    ],
    "5 reps each side, then switch partners.",
    "The partner pretends. They do not squeeze. Stop the drill if anyone's face changes color."
  );

  tech(
    "ls-armbar-triangle",
    "chains",
    1,
    "Mount",
    "Armbar to triangle",
    BIG,
    [
      "Start the mount armbar, slow, and they pull the arm out.",
      "Open your legs, throw one leg over the neck, and lock a triangle.",
      "Hold the shape. Do not squeeze until the teacher says a one-second finish, then let go on the tap.",
    ],
    "3 slow reps each side, then switch partners.",
    "8–10 only. One-second finish, then release. No cranking the neck. Teach the tap before the first rep."
  );
  tech(
    "ls-pass-mount-back",
    "chains",
    2,
    "Open guard",
    "Pass to mount to back",
    BIG,
    [
      "Knee-slice or toreando into side control.",
      "Knee across the belt and settle into mount.",
      "They turn away. Follow to the back and clasp a seatbelt on the chest. No choke.",
    ],
    "3 trips through the chain, then switch partners.",
    "The chain stops at the seatbelt. A rear naked choke is its own drill if the teacher adds it."
  );

  game(
    "gm-shrimp-race",
    "Shrimp race",
    ALL,
    ["side", "kob"],
    "On their backs, feet toward the far edge. Shrimp to the line. First one there picks the next side. No standing up.",
    "Shrimp race! Hips first. First to the line wins a high-five."
  );
  game(
    "gm-guard-tag",
    "Guard tag",
    ALL,
    ["guard", "open-guard"],
    "One tagger. You are safe only while you are sitting in closed guard with a partner. The tagger counts to 5 and you have to let go and find a new partner.",
    "Closed guard makes you safe. Count of five, then switch friends."
  );
  game(
    "gm-mount-switch",
    "Mount switch",
    ALL,
    ["mount"],
    "Start in mount. On 'switch' the bottom person bridges and they trade who is on top. Points for a clean switch, not for speed that knocks heads.",
    "Switch! Bridge, roll, and you are on top. Gentle."
  );
  game(
    "gm-turtle-peek",
    "Turtle peek",
    ALL,
    ["turtle"],
    "Everyone starts in turtle. The teacher calls a side. They peek that way and sit up. Last one still hiding does five jumping jacks.",
    "Turtle! Peek left. Sit up and look at me."
  );
  game(
    "gm-level-tag",
    "Level-change tag",
    OLDER,
    ["takedowns"],
    "Tag only counts if you level-change and touch a knee, then tag the hip. No shots that take people down. It is a tag game that practices the level.",
    "Level change, touch a knee, tag the hip. No takedowns in the game."
  );
  game(
    "gm-sweep-stand",
    "Sweep or stand",
    ALL,
    ["sweeps", "guard"],
    "Pairs. One kid sits in guard and tries to sweep. The partner starts on their knees and tries to stand up. A clean sweep scores, then reset right away. Short rounds. No waiting in line.",
    "Sweep or stand! You sweep. They try to stand up. Clean sweep, then reset.",
    "Mighty Mites keep the top partner on their knees if standing up turns into a pile."
  );

  const tug = DATA.activities.find((activity) => activity.id === "gm-tug-of-war");
  if (tug) tug.themes = ["takedowns"];

  function canonicalTechniqueAges(ages) {
    const list = Array.isArray(ages) ? ages : [];
    if (!list.length) return [];
    const has = (id) => list.includes(id);
    const out = [];
    if (has("mite") || has("peewee")) out.push("mite");
    if (has("peewee") || has("junior") || has("upper")) out.push("upper");
    if (has("toddler")) out.push("toddler");
    if (has("teen") && !out.length) out.push("teen");
    return out;
  }
  DATA.activities.forEach((activity) => {
    if (Array.isArray(activity.ages) && activity.ages.length) {
      activity.ages = canonicalTechniqueAges(activity.ages);
    }
  });
})();
