// ReelSaver AI rules. Only you can change this file (on GitHub: functions/shared/ai-rules.js).
// Do not put secrets or private details here: the AI shows this information to any visitor who asks.

module.exports = {
  // PEOPLE
  // One block per person. You only write the name, other spellings, and what to say.
  // A visitor who writes just "who is Noorin", "Noorin kaun hai", "tell me about Noorin",
  // "Noorin कौन है", "Noorin کون ہے" or "من هو Noorin" gets that text.
  // "about" can be one text, or one text per language: { en: '...', hi: '...', ur: '...', ar: '...' }
  people: [
    {
      name: 'Baseer Ali',
      aliases: ['Baseer', 'Baseer Bob', 'Basir Ali'],
      about: `Baseer Ali is an Indian television personality, actor, model and reality-show star. He became famous through MTV Roadies and Splitsvilla, which he won alongside Naina Singh.
• Ace of Space 2 (2019): second runner-up.
• Kundali Bhagya (2023–2024): acting debut as Shaurya Luthra on Zee TV.
• Bigg Boss 19 (2025): contestant on Salman Khan's reality show.`,
    },
    {
      name: 'Farrhana Bhatt',
      aliases: ['Farrhana', 'Farhana Bhatt', 'Farrhana Bhat'],
      about: `Farrhana Bhatt is an Indian actress, martial artist and peace activist from Kashmir. She became widely popular after taking part in Bigg Boss 19 (2025).
• Bigg Boss 19: first runner-up, with Gaurav Khanna winning the season. She was evicted on the first day but returned through a secret-room twist and reached the finale.
• Films: she played Jasmeet in Laila Majnu (2018) and also appeared in Sunshine Music Tours & Travels and Notebook.
• Taekwondo and activism: she is a national-level Taekwondo medalist and speaks publicly about peace and issues affecting Kashmir.`,
    },
    {
      name: 'Noorin',
      aliases: ['Nurin'],
      about: 'She is a cute girl, an OG Bahana shipper and editor, and a friend of my boss Ahad.',
    },
    {
      name: 'Sana',
      aliases: [],
      about: 'Sana is a sweet, introverted girl and a friend of my boss Ahad. Her favorite ship is #Emsu. She was a Bahana shipper earlier, but she still hopes the Bahana ship will sail.',
    },
    {
      name: 'Jihyo',
      aliases: [],
      about: 'Jihyo is a sensitive, mature person and a friend of my boss Ahad. She advises Ahad like an elder sister. She is a huge K-drama fan and loves gardening.',
    },
    {
      name: 'Riyan',
      aliases: ['Rayan'],
      about: "Riyan is an OG Bahana shipper, an editor and Baseer's biggest fan. He uploaded Bahana ship clips during BB19.",
    },
    {
      name: 'Alice',
      aliases: [],
      about: 'Alice is an introverted, cute girl and a good friend of my boss Ahad. Her craze for the Bahana ship is unreal.',
    },
    {
      name: 'Allie',
      aliases: [],
      about: 'Allie is a good girl, a Bahana shipper and a friend of my boss Ahad. Hope all her dreams come true.',
    },
    {
      name: 'Megha',
      aliases: [],
      about: 'Megha is a sweet, expressive girl who says what she feels without hesitation, which is a great quality. She is a Bahana shipper, a good singer and a friend of my boss Ahad.',
    },
    {
      name: 'Fatima',
      aliases: [],
      about: 'Fatima is a well-known X user, famous for her savage tweets.',
    },
    // To add a person, copy a block above, change the name, aliases and about. Keep the commas.
  ],

  // OTHER FIXED ANSWERS
  // If a visitor writes any phrase from "when" (capitals and punctuation do not matter),
  // they get exactly the text in "say". It costs nothing because the AI is not called.
  answers: [
    {
      when: ['who built you', 'who made you', 'who created you', 'who is your creator', 'who is build you', 'who build you', 'who developed you'],
      say: 'Ahad built me.',
    },
  ],

  // ALWAYS-ON RULES
  // Instructions the AI must follow every time it writes comments or answers.
  always: [
    // 'Never mention other downloader websites.',
  ],
};
