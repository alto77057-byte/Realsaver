// ReelSaver AI rules. Only you can change this file (on GitHub: functions/shared/ai-rules.js).
//
// RIGHT NOW EVERYONE CAN SEE EVERYTHING
// Friends marked  private: true  are shown to all visitors, with no code and no link.
// To lock them again later, set FRIENDS_OPEN to  no  in Netlify (and set FRIENDS_CODE).
// To remove this feature later, empty the lists below or ask me for files without the Ask tab.

module.exports = {
  people: [
    // ---------- public figures (open to everyone) ----------
    {
      name: 'Baseer Ali',
      aliases: ['Baseer', 'Baseer Bob', 'Basir Ali'],
      about: `Baseer Ali is an Indian television personality 📺, actor 🎭, model 📸 and reality-show star ⭐. He became famous through MTV Roadies and Splitsvilla, which he won alongside Naina Singh 🏆.
• 🥉 Ace of Space 2 (2019): second runner-up.
• 🎬 Kundali Bhagya (2023–2024): acting debut as Shaurya Luthra on Zee TV.
• 🏠 Bigg Boss 19 (2025): contestant on Salman Khan's reality show.`,
    },
    {
      name: 'Farrhana Bhatt',
      aliases: ['Farrhana', 'Farhana Bhatt', 'Farrhana Bhat'],
      about: `Farrhana Bhatt is an Indian actress 🎬, martial artist 🥋 and peace activist 🕊️ from Kashmir ⛰️. She became widely popular after taking part in Bigg Boss 19 (2025).
• 🏠 Bigg Boss 19: first runner-up 🥈, with Gaurav Khanna winning the season. She was evicted on the first day but returned through a secret-room twist 🚪 and reached the finale.
• 🎞️ Films: she played Jasmeet in Laila Majnu (2018) and also appeared in Sunshine Music Tours & Travels and Notebook.
• 🥋 Taekwondo and activism: she is a national-level Taekwondo medalist 🏅 and speaks publicly about peace and issues affecting Kashmir.`,
    },

    // ---------- friends (need the friends code) ----------
    {
      name: 'Noorin',
      aliases: ['Nurin'],
      private: true,
      about: 'Noorin is a cute 🌸 and religious 🕌 girl who tries to follow all Islamic instructions 🤲. She is an OG Bahana shipper 🚢 and editor 🎬, and a friend of my boss Ahad 🤝. All her accounts were suspended by Instagram without any proper reason 🚫, and she is furious about it 😤. Hope all her prayers and duas are accepted by Allah 🤲✨.',
    },
    {
      name: 'Sana',
      aliases: [],
      private: true,
      about: 'Sana is a sweet 🌷, religious 🕌, introverted 🤫 girl. She is a medical student 🩺 and a friend of my boss Ahad 🤝. Her favorite ship is #Emsu 💞. She was a Bahana shipper earlier 🚢, but she still hopes that the Bahana ship will sail ⛵. Hope all her prayers and duas are accepted by Allah 🤲, and that she completes her MBBS very easily 🎓 and serves poor people ❤️.',
    },
    {
      name: 'Sans',
      aliases: ['Sanskriti'],
      private: true,
      about: 'Sans is a cute 🎀 girl and a little sister to my boss Ahad 🤗. Her favorite celebrities are Ravi Kishan and SRK ⭐. She is also a Bahana shipper 🚢. Her actual name is Sanskriti, but my boss Ahad calls her Sans 💕.',
    },
    {
      name: 'Jihyo',
      aliases: [],
      private: true,
      about: 'Jihyo is a sensitive 💜, mature 🌿 person and a friend of my boss Ahad 🤝. She used to advise Ahad like an elder sister 💬. She is a huge K-drama fan 📺 and has her own garden 🌱. Nowadays she is determined about her fitness 💪.',
    },
    {
      name: 'Riyan',
      aliases: ['Rayan'],
      private: true,
      about: "Riyan is also an OG Bahana shipper 🚢 and the biggest fan of Baseer ⭐. He is an editor 🎬. He used to upload clips of the Bahana ship during BB19 📹.",
    },
    {
      name: 'Alice',
      aliases: [],
      private: true,
      about: 'Alice is a cute 🧸, introverted 🤫 girl. Hope all her worries are solved soon 🙏. She is a good friend of my boss Ahad 🤝. Her craze for the Bahana ship is unreal 🚢🔥.',
    },
    {
      name: 'Nishi',
      aliases: [],
      private: true,
      about: 'Nishi is a cute 🌼 girl and a little sister to my boss Ahad 🤗. She is a big fan of Farrhana 💖 and also a fan of ⚽ Ronaldo Jr. She is a huge fan of Rakhi Sawant too 💃, and she can sing 🎤.',
    },
    {
      name: 'Fatima',
      aliases: [],
      private: true,
      about: `Fatima is an X celebrity ✖️, famous for her savage tweets 🔥. She has a friend named Umar 🤝, and both of them are famous on X. Maybe they are going to get married next year 💍. My boss Ahad knows this topic very well 🕵️. Her famous tweet is "Bahana Walo ka gifts Wapas karo Hana" 📝.`,
    },
    {
      name: 'Allie',
      aliases: [],
      private: true,
      about: 'Allie is a good girl 🌟 and a Bahana shipper 🚢, and a friend of my boss Ahad 🤝. Hope all her dreams come true ✨.',
    },
    {
      name: 'Luvs',
      aliases: ['Luvswa'],
      private: true,
      about: 'Luvs is an OG Bahana shipper 🚢. She is a little emotional and sensitive 🥺, and a little sister to my boss Ahad 🤗. Many of her accounts were suspended by Instagram without violating any rules 🚫, and she is upset about it 😔. Hope all her worries are gone soon 🌈 and she fulfills her dreams ✨. My boss Ahad calls her Luvswa 💕.',
    },
    {
      name: 'Megha',
      aliases: [],
      private: true,
      about: 'Megha is a sweet 🌺 and expressive girl. She tells what she feels without hesitation 💬, which is a good quality 👍. She is also a Bahana shipper 🚢 and a friend of my boss Ahad 🤝. She is a good singer 🎶. She used to sleep early 😴 and wake up before sunrise 🌅.',
    },
    // To add a person, copy a block, change the name, aliases and about. Add  private: true  for friends.
  ],

  // OTHER FIXED ANSWERS (open to everyone)
  answers: [
    {
      when: ['who built you', 'who made you', 'who created you', 'who is your creator', 'who is build you', 'who build you', 'who developed you'],
      say: 'Ahad built me. 💻✨',
    },
  ],

  // ALWAYS-ON RULES for the AI
  always: [
    // 'Never mention other downloader websites.',
  ],
};
      
