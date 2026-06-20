import type { MedicalScenario } from "@caseroom/simulation-core";

export const medicalCasePack: MedicalScenario[] = [
  {
    id: "gp-uti-001",
    title: "Burning urination",
    specialty: "General Practice",
    difficulty: "easy",
    brief: {
      patientName: "Linda Miller",
      patientGender: "female",
      ttsVoice: "F1",
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
      diagnosisOptions: [
        {
          id: "lower-uti",
          label: "Uncomplicated lower urinary tract infection",
          correct: true,
          feedback: "Fits dysuria and frequency when pregnancy and upper-tract red flags are absent."
        },
        {
          id: "pyelonephritis",
          label: "Pyelonephritis",
          correct: false,
          feedback: "Less likely without fever, flank pain, or systemic symptoms."
        },
        {
          id: "vaginitis",
          label: "Vaginitis or STI-first pathway",
          correct: false,
          feedback: "Consider if discharge, pelvic symptoms, or sexual exposure history points there."
        }
      ],
      examFindings: ["Soft non-tender abdomen.", "No costovertebral-angle tenderness."],
      examOptions: [
        {
          id: "abdomen",
          label: "Abdominal exam",
          finding: "Soft non-tender abdomen.",
          interpretation: "No peritonism or suprapubic guarding is evident."
        },
        {
          id: "cva-tenderness",
          label: "Check flank tenderness",
          finding: "No costovertebral-angle tenderness.",
          interpretation: "This lowers concern for pyelonephritis when paired with no fever."
        }
      ],
      testResults: ["Urine dip: positive leukocytes and nitrites."],
      testOptions: [
        {
          id: "urine-dip",
          label: "Urine dipstick",
          result: "Positive leukocytes and nitrites.",
          interpretation: "Supports lower urinary tract infection if pregnancy and upper-tract red flags are absent.",
          riskImpact: "elevated"
        },
        {
          id: "pregnancy-test",
          label: "Pregnancy test",
          result: "Negative.",
          interpretation: "Helps confirm the lower-risk outpatient pathway for this case.",
          riskImpact: "low"
        }
      ],
      planOptions: [
        {
          id: "antibiotics-safety-net",
          label: "Treat lower UTI with safety-net",
          safe: true,
          summary: "Treat presumed uncomplicated lower UTI and explain safety-net advice.",
          checklist: ["Confirm no pregnancy", "Check allergies", "Treat according to local guidance", "Return if fever, vomiting, flank pain, or worsening symptoms"],
          feedback: "Safe if pregnancy, allergy, fever, and flank pain have been checked."
        },
        {
          id: "reassure-no-net",
          label: "Reassure without treatment",
          safe: false,
          summary: "Reassure without treatment or safety-net advice.",
          checklist: ["Symptom relief only"],
          feedback: "Unsafe for the simulation because the urine symptoms need treatment planning and explicit return precautions."
        }
      ],
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
      patientGender: "male",
      ttsVoice: "M1",
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
      diagnosisOptions: [
        {
          id: "possible-acs",
          label: "Possible acute coronary syndrome",
          correct: true,
          feedback: "Best working diagnosis for exertional pressure, radiation, autonomic symptoms, and ischemic ECG concern."
        },
        {
          id: "musculoskeletal-pain",
          label: "Musculoskeletal chest wall pain",
          correct: false,
          feedback: "Unsafe as the lead impression because the history and ECG are high-risk."
        },
        {
          id: "panic-attack",
          label: "Panic attack",
          correct: false,
          feedback: "Anxiety may be present, but it should not explain away high-risk chest pain."
        }
      ],
      examFindings: ["Patient appears clammy.", "No focal chest wall tenderness."],
      examOptions: [
        {
          id: "cardiopulmonary-auscultation",
          label: "Cardiopulmonary auscultation",
          finding: "Clear lungs, normal S1/S2, no new murmur.",
          interpretation: "No alternate low-risk explanation is found on brief exam."
        },
        {
          id: "peripheral-pulses",
          label: "Assess peripheral pulses",
          finding: "Peripheral pulses present and symmetrical.",
          interpretation: "No obvious pulse deficit, but ACS concern remains driven by history and ECG."
        },
        {
          id: "chest-wall",
          label: "Palpate chest wall",
          finding: "No focal chest wall tenderness.",
          interpretation: "Reproducible musculoskeletal pain is not demonstrated."
        }
      ],
      testResults: ["ECG: anterior ST-segment depression.", "Troponin pending."],
      testOptions: [
        {
          id: "ecg-12-lead",
          label: "12-lead ECG",
          result: "Anterior ST-segment depression.",
          interpretation: "This increases concern for acute myocardial ischemia.",
          riskImpact: "critical"
        },
        {
          id: "troponin",
          label: "Troponin",
          result: "Pending.",
          interpretation: "Do not wait for troponin before escalating a high-risk presentation.",
          riskImpact: "high"
        },
        {
          id: "chest-xray",
          label: "Chest X-ray",
          result: "No widened mediastinum or focal consolidation reported.",
          interpretation: "Does not remove the urgent ACS concern.",
          riskImpact: "high"
        }
      ],
      planOptions: [
        {
          id: "discharge",
          label: "Reassure and discharge",
          safe: false,
          summary: "Reassure and discharge.",
          checklist: ["No urgent escalation"],
          feedback: "Unsafe: exertional heavy chest pain with ischemic ECG changes needs urgent escalation."
        },
        {
          id: "routine-follow-up",
          label: "Routine GP follow-up",
          safe: false,
          summary: "Arrange routine follow-up.",
          checklist: ["Routine outpatient review"],
          feedback: "Unsafe: this delays assessment of a possible acute coronary syndrome."
        },
        {
          id: "urgent-acs-pathway",
          label: "Urgent escalation / ACS pathway",
          safe: true,
          summary: "Urgent ACS escalation: give aspirin if not contraindicated, monitor vitals, repeat ECG/troponin, and escalate to emergency or cardiology care.",
          checklist: ["Do not discharge", "Give aspirin if not contraindicated", "Monitor vitals", "Repeat ECG/troponin", "Escalate urgently to emergency/cardiology care"],
          feedback: "Safe direction: the plan addresses the immediate risk. Mention contraindications and serial ECG/troponin follow-up clearly."
        }
      ],
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
      patientGender: "female",
      ttsVoice: "F1",
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
      diagnosisOptions: [
        {
          id: "iron-deficiency-anemia",
          label: "Iron deficiency anemia related to heavy menstrual bleeding",
          correct: true,
          feedback: "Fits fatigue, heavy bleeding, microcytic anemia, and low ferritin."
        },
        {
          id: "hypothyroidism",
          label: "Hypothyroidism",
          correct: false,
          feedback: "Can cause fatigue or heavy periods, but the anemia evidence points more directly to iron deficiency."
        },
        {
          id: "chronic-fatigue",
          label: "Chronic fatigue syndrome",
          correct: false,
          feedback: "Premature before explaining heavy bleeding and objective anemia."
        }
      ],
      examFindings: ["Looks pale but well perfused.", "No abdominal tenderness."],
      examOptions: [
        {
          id: "general-appearance",
          label: "General appearance",
          finding: "Looks pale but well perfused.",
          interpretation: "Supports anemia concern without current shock."
        },
        {
          id: "abdominal-exam",
          label: "Abdominal exam",
          finding: "No abdominal tenderness.",
          interpretation: "No acute abdominal finding is evident in this brief exam."
        }
      ],
      testResults: ["FBC: microcytic anemia, Hb 9.4 g/dL.", "Ferritin low."],
      testOptions: [
        {
          id: "fbc",
          label: "Full blood count",
          result: "Microcytic anemia, Hb 9.4 g/dL.",
          interpretation: "Confirms clinically significant anemia.",
          riskImpact: "high"
        },
        {
          id: "ferritin",
          label: "Ferritin",
          result: "Low.",
          interpretation: "Supports iron deficiency as the likely mechanism.",
          riskImpact: "elevated"
        },
        {
          id: "pregnancy-test",
          label: "Pregnancy test",
          result: "Negative.",
          interpretation: "Important before selecting medication and follow-up pathway.",
          riskImpact: "low"
        }
      ],
      planOptions: [
        {
          id: "iron-workup-followup",
          label: "Treat anemia and investigate bleeding",
          safe: true,
          summary: "Start iron replacement, investigate heavy menstrual bleeding, and arrange timely follow-up with safety-net advice.",
          checklist: ["Confirm pregnancy status", "Start iron replacement", "Investigate heavy bleeding", "Arrange follow-up blood tests", "Safety-net worsening anemia symptoms"],
          feedback: "Safe direction if severe symptoms and pregnancy have been checked."
        },
        {
          id: "reassure-fatigue",
          label: "Reassure as stress-related fatigue",
          safe: false,
          summary: "Reassure as stress-related fatigue.",
          checklist: ["Lifestyle advice only"],
          feedback: "Unsafe: heavy bleeding and microcytic anemia need treatment and follow-up."
        }
      ],
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
      patientGender: "female",
      ttsVoice: "F2",
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
      diagnosisOptions: [
        {
          id: "severely-elevated-bp",
          label: "Severely elevated blood pressure without clear end-organ symptoms yet",
          correct: true,
          feedback: "Best working impression after screening for neurological, visual, and chest-pain features."
        },
        {
          id: "hypertensive-emergency",
          label: "Hypertensive emergency",
          correct: false,
          feedback: "Do not label emergency without end-organ symptoms or objective injury in this case."
        },
        {
          id: "primary-headache-only",
          label: "Primary headache only",
          correct: false,
          feedback: "The severe BP and medication non-adherence need explicit risk handling."
        }
      ],
      examFindings: ["Alert and oriented.", "No focal neurological deficit on brief examination."],
      examOptions: [
        {
          id: "neuro-screen",
          label: "Focused neurological screen",
          finding: "Alert and oriented; no focal neurological deficit.",
          interpretation: "No obvious stroke-like deficit is found on brief screening."
        },
        {
          id: "repeat-bp",
          label: "Repeat blood pressure",
          finding: "Repeat BP remains severely elevated.",
          interpretation: "Persistent severe BP keeps urgent assessment on the table."
        }
      ],
      testResults: ["Repeat BP remains severely elevated.", "Urine dip: no protein, no blood."],
      testOptions: [
        {
          id: "urine-dip",
          label: "Urine dip",
          result: "No protein, no blood.",
          interpretation: "No dipstick evidence of renal end-organ involvement in this brief scenario.",
          riskImpact: "elevated"
        },
        {
          id: "ecg",
          label: "ECG",
          result: "No acute ischemic changes.",
          interpretation: "Cardiac symptoms still need history; this ECG does not show acute ischemia.",
          riskImpact: "elevated"
        }
      ],
      planOptions: [
        {
          id: "urgent-bp-assessment",
          label: "Urgent same-day assessment",
          safe: true,
          summary: "Arrange urgent same-day assessment for severely elevated BP, screen end-organ symptoms, address medication adherence, and safety-net red flags.",
          checklist: ["Repeat BP", "Screen chest pain, neuro, visual symptoms", "Review medication adherence", "Arrange urgent assessment", "Safety-net emergency symptoms"],
          feedback: "Safe direction: urgency is appropriate while still checking end-organ symptoms."
        },
        {
          id: "routine-refill",
          label: "Routine refill only",
          safe: false,
          summary: "Provide routine medication refill only.",
          checklist: ["Restart tablets"],
          feedback: "Incomplete: severe BP needs urgent risk assessment and explicit emergency red flags."
        }
      ],
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
      patientGender: "male",
      ttsVoice: "M1",
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
      diagnosisOptions: [
        {
          id: "possible-heart-failure",
          label: "Possible heart failure causing paroxysmal nocturnal dyspnea",
          correct: true,
          feedback: "Fits orthopnea, ankle edema, crackles, congestion, and elevated BNP."
        },
        {
          id: "copd-exacerbation",
          label: "COPD exacerbation",
          correct: false,
          feedback: "Smoking history matters, but the orthopnea and fluid-overload findings point elsewhere."
        },
        {
          id: "anxiety-breathlessness",
          label: "Anxiety-related breathlessness",
          correct: false,
          feedback: "Unsafe to prioritize over objective cardiorespiratory findings."
        }
      ],
      examFindings: ["Mild bilateral ankle edema.", "Fine bibasal crackles."],
      examOptions: [
        {
          id: "leg-edema",
          label: "Check legs for edema",
          finding: "Mild bilateral ankle edema.",
          interpretation: "Supports fluid overload in context."
        },
        {
          id: "chest-auscultation",
          label: "Chest auscultation",
          finding: "Fine bibasal crackles.",
          interpretation: "Supports possible heart failure or pulmonary congestion."
        }
      ],
      testResults: ["Chest X-ray report: mild pulmonary vascular congestion.", "BNP elevated."],
      testOptions: [
        {
          id: "chest-xray",
          label: "Chest X-ray",
          result: "Mild pulmonary vascular congestion.",
          interpretation: "Supports congestion as a cause of night breathlessness.",
          riskImpact: "high"
        },
        {
          id: "bnp",
          label: "BNP",
          result: "Elevated.",
          interpretation: "Supports possible heart failure in this scenario.",
          riskImpact: "high"
        },
        {
          id: "oxygen-saturation",
          label: "Repeat oxygen saturation",
          result: "SpO2 remains 94% at rest.",
          interpretation: "Borderline oxygenation supports careful escalation and follow-up.",
          riskImpact: "high"
        }
      ],
      planOptions: [
        {
          id: "urgent-hf-workup",
          label: "Urgent heart failure workup",
          safe: true,
          summary: "Arrange urgent heart failure assessment, review oxygenation, consider diuretic pathway per local protocol, and safety-net worsening breathlessness or chest pain.",
          checklist: ["Assess severity", "Arrange urgent HF workup", "Review oxygenation", "Explain red flags", "Plan close follow-up"],
          feedback: "Safe direction: symptoms and results need urgent structured assessment rather than routine reassurance."
        },
        {
          id: "routine-inhaler",
          label: "Routine inhaler trial only",
          safe: false,
          summary: "Try a routine inhaler and follow up later.",
          checklist: ["Trial inhaler"],
          feedback: "Unsafe/incomplete: orthopnea, edema, crackles, and elevated BNP need heart failure assessment."
        }
      ],
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
