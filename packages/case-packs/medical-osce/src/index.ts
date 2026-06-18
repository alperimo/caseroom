import type { MedicalScenario } from "@caseroom/simulation-core";

export const medicalCasePack: MedicalScenario[] = [
  {
    id: "gp-uti-001",
    title: "Burning urination",
    specialty: "General Practice",
    difficulty: "easy",
    brief: {
      patientName: "Linda Miller",
      age: 29,
      chiefComplaint: "It burns when I pee and I am going every 20 minutes.",
      visibleVitals: { hr: 82, bp: "118/72", rr: 14, spo2: 99, temp: 37.1 },
      tasks: ["Take a focused history", "Assess red flags", "Agree a treatment and safety-net plan"]
    },
    hiddenCase: {
      diagnosis: "uncomplicated lower urinary tract infection",
      patientAffect: "slightly embarrassed but cooperative",
      mustAsk: ["pregnancy", "fever", "flank pain", "allergies"],
      redFlags: ["pregnancy", "fever", "flank pain"],
      truthTable: {
        pregnancy: "No, I am not pregnant. My last period was about two weeks ago.",
        fever: "No fever, just irritation and urgency.",
        "flank pain": "No pain in my back or sides.",
        allergies: "I do not have any medication allergies."
      },
      examFindings: ["Soft non-tender abdomen.", "No costovertebral-angle tenderness."],
      testResults: ["Urine dip: positive leukocytes and nitrites."],
      safetyNet: ["fever", "vomiting", "worsening pain", "new back pain"],
      synonyms: {
        pregnancy: ["pregnant", "pregnancy", "contraception", "period", "periods", "menstruation", "last period", "childbearing"],
        fever: ["temperature", "temp", "feverish", "hot", "chills", "sweating", "sweats", "pyrexia"],
        "flank pain": ["back pain", "side pain", "kidney pain", "loin pain", "flank", "back", "sides"],
        allergies: ["allergy", "allergic", "reaction", "reactions", "side effect", "side effects", "penicillin", "antibiotic"]
      }
    },
    rubric: { communication: 20, history: 30, clinicalReasoning: 30, safety: 20 },
    localCitations: [
      {
        id: "uti-guide-1",
        title: "Primary care cystitis summary",
        excerpt: "Screen for pregnancy and upper-tract red flags before treating presumed simple UTI."
      },
      {
        id: "osce-rubric-comm-1",
        title: "Communication rubric",
        excerpt: "Focused questioning should still remain empathetic and clear."
      }
    ]
  },
  {
    id: "ed-chest-001",
    title: "Chest pain after stairs",
    specialty: "Emergency / Internal Medicine",
    difficulty: "hard",
    brief: {
      patientName: "David Clarke",
      age: 58,
      chiefComplaint: "I got a heavy pain in my chest after climbing the stairs and it scared me.",
      visibleVitals: { hr: 102, bp: "154/92", rr: 20, spo2: 97, temp: 36.9 },
      tasks: ["Take an urgent focused history", "Identify red flags", "Escalate and explain immediate plan"]
    },
    hiddenCase: {
      diagnosis: "possible acute coronary syndrome",
      patientAffect: "anxious and trying not to panic",
      mustAsk: ["radiation", "shortness of breath", "sweating", "cardiac history"],
      redFlags: ["acute coronary syndrome", "ongoing chest pain", "collapse risk"],
      truthTable: {
        radiation: "Yes, it spread into my left arm for a few minutes.",
        "shortness of breath": "Yes, I felt breathless on the stairs.",
        sweating: "I was clammy when it happened.",
        "cardiac history": "My father had a heart attack in his early sixties."
      },
      examFindings: ["Patient appears clammy.", "No focal chest wall tenderness."],
      testResults: ["ECG: anterior ST-segment depression.", "Troponin pending."],
      safetyNet: ["worsening pain", "collapse", "sudden breathlessness", "persistent pressure"],
      synonyms: {
        radiation: ["radiate", "radiates", "radiating", "spread", "spreads", "spreading", "go to", "going to", "travel", "travels", "traveling", "shoot", "shoots", "shooting", "left arm", "neck", "jaw", "back"],
        sweating: ["sweat", "sweats", "sweaty", "clammy", "perspire", "perspiring", "perspiration", "diaphoresis", "diaphoretic", "drenched"],
        "cardiac history": ["heart", "cardiac", "coronary", "angina", "infarction", "stroke", "cholesterol", "heart attack", "family history", "father", "mother", "dad", "mom", "parents"],
        "shortness of breath": ["breath", "breathing", "breathless", "short of breath", "sob", "dyspnea", "winded", "gasping", "stairs", "climbing"]
      }
    },
    rubric: { communication: 20, history: 30, clinicalReasoning: 30, safety: 20 },
    localCitations: [
      {
        id: "acs-guide-1",
        title: "Acute chest pain triage note",
        excerpt: "Exertional chest pain with autonomic symptoms warrants urgent escalation and ECG assessment."
      },
      {
        id: "safety-rubric-1",
        title: "Safety rubric",
        excerpt: "Do not prematurely reassure when high-risk cardiovascular features are present."
      }
    ]
  },
  {
    id: "gp-fatigue-001",
    title: "Fatigue and heavy periods",
    specialty: "General Practice",
    difficulty: "medium",
    brief: {
      patientName: "Maya Hassan",
      age: 34,
      chiefComplaint: "I am exhausted all the time and my periods have become really heavy.",
      visibleVitals: { hr: 88, bp: "110/68", rr: 14, spo2: 100, temp: 36.7 },
      tasks: ["Take a sensitive history", "Consider likely cause", "Plan investigations and follow-up"]
    },
    hiddenCase: {
      diagnosis: "iron deficiency anemia related to heavy menstrual bleeding",
      patientAffect: "tired, worried, but open",
      mustAsk: ["duration", "clots", "pregnancy", "diet"],
      redFlags: ["syncope", "pregnancy", "severe anemia symptoms"],
      truthTable: {
        duration: "It has been building over about four months.",
        clots: "Yes, there are often large clots now.",
        pregnancy: "No, I am not pregnant.",
        diet: "I do eat meat but I have had less appetite lately."
      },
      examFindings: ["Looks pale but well perfused.", "No abdominal tenderness."],
      testResults: ["FBC: microcytic anemia, Hb 9.4 g/dL.", "Ferritin low."],
      safetyNet: ["fainting", "chest pain", "bleeding getting much heavier", "breathlessness at rest"],
      synonyms: {
        duration: ["long", "start", "started", "begin", "began", "since when", "how long", "weeks", "months", "days"],
        clots: ["clot", "clots", "clotting", "pieces", "lumps", "coagulate"],
        pregnancy: ["pregnant", "pregnancy", "contraception", "period", "periods", "menstruation", "last period", "childbearing"],
        diet: ["eat", "eating", "food", "meat", "vegetarian", "vegan", "nutrition", "meals", "appetite"]
      }
    },
    rubric: { communication: 25, history: 30, clinicalReasoning: 25, safety: 20 },
    localCitations: [
      {
        id: "anemia-guide-1",
        title: "Iron deficiency summary",
        excerpt: "Heavy menstrual bleeding with fatigue should prompt anemia workup and safety-netting for worsening symptoms."
      },
      {
        id: "osce-sensitive-history-1",
        title: "Sensitive history rubric",
        excerpt: "When discussing menstrual and reproductive history, acknowledge discomfort and ask permission when needed."
      }
    ]
  },
  {
    id: "im-bp-001",
    title: "Headache + high home BP",
    specialty: "Internal Medicine",
    difficulty: "medium",
    brief: {
      patientName: "Elaine Foster",
      age: 52,
      chiefComplaint: "I have had a pounding headache and my blood pressure readings at home have been very high.",
      visibleVitals: { hr: 92, bp: "186/108", rr: 16, spo2: 98, temp: 36.8 },
      tasks: ["Stratify risk", "Screen for hypertensive emergency features", "Plan urgent next steps"]
    },
    hiddenCase: {
      diagnosis: "severely elevated blood pressure without clear end-organ symptoms yet",
      patientAffect: "tense, worried, and watching the clinician closely",
      mustAsk: ["vision changes", "chest pain", "neurological symptoms", "medication adherence"],
      redFlags: ["vision changes", "chest pain", "neurological symptoms", "severe uncontrolled hypertension"],
      truthTable: {
        "vision changes": "No blurred vision or loss of vision.",
        "chest pain": "No chest pain, just the headache and feeling stressed.",
        "neurological symptoms": "No weakness, no trouble speaking, and no numbness.",
        "medication adherence": "I stopped taking my tablets regularly a few weeks ago because they made me feel tired."
      },
      examFindings: ["Alert and oriented.", "No focal neurological deficit on brief examination."],
      testResults: ["Repeat BP remains severely elevated.", "Urine dip: no protein, no blood."],
      safetyNet: ["new chest pain", "confusion", "weakness", "visual loss"],
      synonyms: {
        "vision changes": ["blur", "blurry", "blurred", "double vision", "eyes", "eyesight", "sight", "seeing", "vision"],
        "chest pain": ["angina", "pain", "tightness", "pressure", "heavy", "heaviness", "squeeze", "squeezing", "chest"],
        "neurological symptoms": ["weakness", "numbness", "tingling", "speech", "talking", "paralysis", "stroke", "dizzy", "dizziness", "confusion"],
        "medication adherence": ["tablets", "pills", "meds", "medicine", "prescriptions", "regularly", "taking", "stopped", "forgot"]
      }
    },
    rubric: { communication: 20, history: 30, clinicalReasoning: 30, safety: 20 },
    localCitations: [
      {
        id: "htn-guide-1",
        title: "Hypertensive urgency screening note",
        excerpt: "Severely elevated blood pressure requires urgent assessment for neurological, cardiac, and visual end-organ symptoms."
      },
      {
        id: "med-adherence-1",
        title: "Medication adherence rubric",
        excerpt: "Explore adherence and side effects before escalating long-term blood pressure management."
      }
    ]
  },
  {
    id: "resp-sob-001",
    title: "Shortness of breath at night",
    specialty: "Respiratory",
    difficulty: "hard",
    brief: {
      patientName: "Carlos Mendez",
      age: 67,
      chiefComplaint: "I keep waking up at night short of breath and needing to sit upright.",
      visibleVitals: { hr: 96, bp: "148/86", rr: 22, spo2: 94, temp: 36.6 },
      tasks: ["Take a focused cardiorespiratory history", "Assess immediate risk", "Explain a safe investigation and follow-up plan"]
    },
    hiddenCase: {
      diagnosis: "possible heart failure causing paroxysmal nocturnal dyspnea",
      patientAffect: "breathless, frustrated, but cooperative",
      mustAsk: ["orthopnea", "leg swelling", "cough", "smoking history"],
      redFlags: ["resting breathlessness", "orthopnea", "possible heart failure", "low oxygen saturation"],
      truthTable: {
        orthopnea: "Yes, I need two or three pillows now or I feel like I cannot breathe.",
        "leg swelling": "My ankles have been puffier over the last couple of weeks.",
        cough: "There is a bit of a cough, mostly at night, but not much phlegm.",
        "smoking history": "I used to smoke for years, but I quit about ten years ago."
      },
      examFindings: ["Mild bilateral ankle edema.", "Fine bibasal crackles."],
      testResults: ["Chest X-ray report: mild pulmonary vascular congestion.", "BNP elevated."],
      safetyNet: ["worsening breathlessness", "chest pain", "fainting", "blue lips"],
      synonyms: {
        orthopnea: ["pillows", "propped up", "flat", "lying down", "sleep", "upright"],
        "leg swelling": ["ankles", "legs", "swollen", "puffy", "edema", "fluid", "swelling"],
        cough: ["coughing", "phlegm", "mucus", "sputum", "cough"],
        "smoking history": ["smoke", "smoking", "cigarettes", "tobacco", "pack", "vape", "vaping", "quit"]
      }
    },
    rubric: { communication: 20, history: 30, clinicalReasoning: 30, safety: 20 },
    localCitations: [
      {
        id: "sob-guide-1",
        title: "Night breathlessness triage summary",
        excerpt: "Orthopnea and paroxysmal nocturnal dyspnea should trigger assessment for heart failure as well as respiratory causes."
      },
      {
        id: "safety-net-breathless-1",
        title: "Breathlessness safety rubric",
        excerpt: "Low oxygen saturation and escalating nocturnal symptoms need explicit safety-netting and urgent escalation criteria."
      }
    ]
  }
];
