export const shareCreatives = [
  {
    id: "blue-rocket",
    name: "Blue rocket",
    src: "/share-creatives/internship-blue-rocket.jpg",
    width: 1024,
    height: 1536,
  },
  {
    id: "purple-student",
    name: "Purple student",
    src: "/share-creatives/internship-purple-student.jpg",
    width: 1024,
    height: 1536,
  },
  {
    id: "clean-student",
    name: "Clean student",
    src: "/share-creatives/internship-clean-student.jpg",
    width: 632,
    height: 958,
  },
  {
    id: "stipend-badge",
    name: "Stipend badge",
    src: "/share-creatives/internship-stipend-badge.jpg",
    width: 1024,
    height: 1536,
  },
] as const;

export function findShareCreative(value: string | undefined) {
  return shareCreatives.find((creative) => creative.id === value) ?? shareCreatives[0];
}

export function buildWhatsAppDraft(link: string) {
  return `🚀 DIRECT STIPEND-BASED INTERNSHIP | APPLY NOW!

Looking for an internship that adds real value to your resume while letting you earn a stipend?

✅ Live Industry Projects
✅ Expert Mentor Guidance
✅ Internship Certificate
✅ Letter of Recommendation
✅ Placement Assistance
💸 Performance-Based Stipend: ₹18,000 – ₹25,000

🎯 Open for UG & PG Students across multiple Engineering & Management domains.

📩 Interested? Register here: ${link}`;
}
