export type InternshipDomain = {
  name: string;
  description: string;
  visual: "technology" | "business" | "engineering" | "people";
};

export const internshipDomains: InternshipDomain[] = [
  { name: "Data Science", description: "Turn complex data into decisions and measurable insights.", visual: "technology" },
  { name: "Machine Learning", description: "Build predictive models that learn from real-world data.", visual: "technology" },
  { name: "Artificial Intelligence", description: "Explore intelligent systems, automation and applied AI.", visual: "technology" },
  { name: "Web Development", description: "Create responsive products using modern web technologies.", visual: "technology" },
  { name: "AWS Cloud Computing", description: "Learn cloud infrastructure, deployment and scalable systems.", visual: "technology" },
  { name: "Human Resource", description: "Understand hiring, people operations and workplace strategy.", visual: "business" },
  { name: "Digital Marketing", description: "Plan campaigns, grow audiences and measure digital performance.", visual: "business" },
  { name: "Finance", description: "Work with financial analysis, planning and business fundamentals.", visual: "business" },
  { name: "Stock Market & Crypto Trading", description: "Study markets, risk, research and trading frameworks.", visual: "business" },
  { name: "IOT", description: "Connect sensors, devices and software into useful smart systems.", visual: "engineering" },
  { name: "Embedded System", description: "Program hardware-focused systems for practical applications.", visual: "engineering" },
  { name: "AutoCAD", description: "Develop precise technical drawings and engineering designs.", visual: "engineering" },
  { name: "Cyber Security", description: "Understand threats, secure systems and defensive practices.", visual: "technology" },
  { name: "VLSI", description: "Explore chip design, digital electronics and semiconductor systems.", visual: "engineering" },
  { name: "Logistic and Supply Chain", description: "Improve how products, inventory and operations move.", visual: "business" },
  { name: "Drone Mechanics", description: "Learn unmanned systems, components and flight technology.", visual: "engineering" },
  { name: "Business Analytics", description: "Use evidence and dashboards to solve business problems.", visual: "business" },
  { name: "Medical Coding", description: "Understand structured healthcare records and coding workflows.", visual: "people" },
  { name: "Data Analytics", description: "Clean, visualize and interpret data for practical outcomes.", visual: "technology" },
  { name: "Psychology", description: "Explore human behaviour, communication and applied psychology.", visual: "people" },
  { name: "Java", description: "Build strong programming foundations and backend applications.", visual: "technology" },
  { name: "UI/UX", description: "Design useful digital experiences around real user needs.", visual: "people" },
  { name: "Hybrid Electric Vehicle", description: "Explore EV systems, power electronics and future mobility.", visual: "engineering" },
];

export const internshipDomainNames = internshipDomains.map(
  (domain) => domain.name,
);

export function isInternshipDomain(value: unknown): value is string {
  return (
    typeof value === "string" &&
    internshipDomainNames.includes(value.trim())
  );
}
