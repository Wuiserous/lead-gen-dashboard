export type InternshipDomain = {
  name: string;
  description: string;
  image: string;
};

export const internshipDomains: InternshipDomain[] = [
  { name: "Data Science", description: "Turn complex data into decisions and measurable insights.", image: "/domains/data-science.webp" },
  { name: "Machine Learning", description: "Build predictive models that learn from real-world data.", image: "/domains/machine-learning.webp" },
  { name: "Artificial Intelligence", description: "Explore intelligent systems, automation and applied AI.", image: "/domains/artificial-intelligence.webp" },
  { name: "Web Development", description: "Create responsive products using modern web technologies.", image: "/domains/web-development.webp" },
  { name: "AWS Cloud Computing", description: "Learn cloud infrastructure, deployment and scalable systems.", image: "/domains/aws-cloud-computing.webp" },
  { name: "Human Resource", description: "Understand hiring, people operations and workplace strategy.", image: "/domains/human-resource.webp" },
  { name: "Digital Marketing", description: "Plan campaigns, grow audiences and measure digital performance.", image: "/domains/digital-marketing.webp" },
  { name: "Finance", description: "Work with financial analysis, planning and business fundamentals.", image: "/domains/finance.webp" },
  { name: "Stock Market & Crypto Trading", description: "Study markets, risk, research and trading frameworks.", image: "/domains/stock-market-crypto-trading.webp" },
  { name: "IOT", description: "Connect sensors, devices and software into useful smart systems.", image: "/domains/iot.webp" },
  { name: "Embedded System", description: "Program hardware-focused systems for practical applications.", image: "/domains/embedded-system.webp" },
  { name: "AutoCAD", description: "Develop precise technical drawings and engineering designs.", image: "/domains/autocad.webp" },
  { name: "Cyber Security", description: "Understand threats, secure systems and defensive practices.", image: "/domains/cyber-security.webp" },
  { name: "VLSI", description: "Explore chip design, digital electronics and semiconductor systems.", image: "/domains/vlsi.webp" },
  { name: "Logistic and Supply Chain", description: "Improve how products, inventory and operations move.", image: "/domains/logistic-supply-chain.webp" },
  { name: "Drone Mechanics", description: "Learn unmanned systems, components and flight technology.", image: "/domains/drone-mechanics.webp" },
  { name: "Business Analytics", description: "Use evidence and dashboards to solve business problems.", image: "/domains/business-analytics.webp" },
  { name: "Medical Coding", description: "Understand structured healthcare records and coding workflows.", image: "/domains/medical-coding.webp" },
  { name: "Data Analytics", description: "Clean, visualize and interpret data for practical outcomes.", image: "/domains/data-analytics.webp" },
  { name: "Psychology", description: "Explore human behaviour, communication and applied psychology.", image: "/domains/psychology.webp" },
  { name: "Java", description: "Build strong programming foundations and backend applications.", image: "/domains/java.webp" },
  { name: "UI/UX", description: "Design useful digital experiences around real user needs.", image: "/domains/ui-ux.webp" },
  { name: "Hybrid Electric Vehicle", description: "Explore EV systems, power electronics and future mobility.", image: "/domains/hybrid-electric-vehicle.webp" },
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
