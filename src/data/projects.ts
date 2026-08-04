/**
 * Portfolio project ideas for a medical-device R&D career direction.
 *
 * PROVENANCE: these are **authored suggestions**, not data from BYU-Idaho or
 * any employer. Every `courses` entry is a real course id from courses.json,
 * and the write-ups are built on those courses' actual subject matter, but the
 * projects themselves are editorial. Nothing here should be presented as a
 * university requirement or as a verified path to employment. See DATA_GAPS M2.
 */
export interface Project {
  id: string;
  title: string;
  blurb: string;
  /** Real course ids whose material this project applies. */
  courses: string[];
  /** What a hiring manager in medical-device R&D gets out of it. */
  why: string;
  /** Concrete build steps / deliverables. */
  deliverables: string[];
  /** Regulatory or quality angle — the differentiator in this industry. */
  regulatory?: string;
  tags: string[];
}

export const PROJECTS: Project[] = [
  {
    id: "ecg-frontend",
    title: "Three-lead ECG analog front end",
    blurb:
      "Build an instrumentation amplifier that pulls a millivolt cardiac signal out of the noise, with proper patient isolation.",
    courses: ["ECEN150", "ECEN250", "ECEN350", "ECEN299"],
    why: "Biopotential front ends are the bread and butter of cardiac device R&D. Showing you understand common-mode rejection, right-leg drive, and isolation is directly on-point for an entry-level hardware role.",
    deliverables: [
      "Instrumentation amp with a measured CMRR figure",
      "50/60 Hz notch and 0.5–40 Hz band-pass stage",
      "Isolated power and signal path; document the patient-leakage-current reasoning",
      "Captured waveforms next to a reference recording",
    ],
    regulatory:
      "IEC 60601-1 patient isolation is the reason this circuit looks the way it does — say so in your writeup.",
    tags: ["analog", "biosignal", "hardware"],
  },
  {
    id: "pulse-ox",
    title: "Reflectance pulse oximeter",
    blurb:
      "Drive red/IR LEDs, recover the photoplethysmogram, and compute SpO2 from the ratio-of-ratios.",
    courses: ["ECEN260", "ECEN361", "ECEN250", "PH220"],
    why: "A complete sensor-to-number pipeline: optics, analog conditioning, timing-critical firmware, and a calibration curve. It demonstrates you can own a measurement end to end.",
    deliverables: [
      "Time-multiplexed LED drive with synchronous detection",
      "Ambient-light rejection scheme",
      "SpO2 and heart-rate calculation with your calibration assumptions written down",
      "Honest error analysis against a commercial unit",
    ],
    regulatory:
      "Note where your device would need clinical validation before any real claim — the limits matter more than the demo.",
    tags: ["sensors", "embedded", "optics"],
  },
  {
    id: "biosignal-dsp",
    title: "Real-time biosignal filter chain",
    blurb:
      "Design and implement digital filters that clean an ECG or EMG stream without destroying diagnostic morphology.",
    courses: ["ECEN380", "ECEN480", "MATH316"],
    why: "Signal integrity decisions in medical devices are clinical decisions. Showing you can defend a filter's phase response against diagnostic requirements is a genuinely senior instinct.",
    deliverables: [
      "FIR and IIR implementations with plotted magnitude/phase response",
      "Baseline-wander and motion-artifact removal",
      "Before/after morphology comparison on a public dataset",
      "Fixed-point version sized for a microcontroller",
    ],
    tags: ["dsp", "biosignal", "firmware"],
  },
  {
    id: "arrhythmia-ml",
    title: "Arrhythmia classifier with an honest error budget",
    blurb:
      "Train a beat classifier on open ECG data and report where and how it fails.",
    courses: ["CSE450", "DS250", "MATH341", "MATH330"],
    why: "Medical AI hiring cares far more about calibration, class imbalance, and false-negative cost than about accuracy. A carefully-caveated model beats a flashy one.",
    deliverables: [
      "Baseline vs. learned model with per-class sensitivity and specificity",
      "Confusion matrix weighted by clinical cost of each error",
      "Patient-wise (not beat-wise) train/test split, and an explanation of why",
      "A written statement of what the model must not be used for",
    ],
    regulatory:
      "Frame it against FDA Software as a Medical Device thinking: intended use, risk class, and change control.",
    tags: ["ml", "data", "biosignal"],
  },
  {
    id: "infusion-control",
    title: "Infusion-pump flow controller",
    blurb:
      "Model a fluid-delivery actuator and close a control loop with fault detection on top.",
    courses: ["ECEN470", "MATH316", "ECEN361"],
    why: "Closed-loop delivery is where control theory meets patient safety. Occlusion and free-flow detection show you think about failure, which is the job.",
    deliverables: [
      "Plant model plus PID or state-feedback design with margins",
      "Step-response and disturbance-rejection measurements",
      "Occlusion detection and a safe-state shutdown path",
      "Failure-mode table for the control loop",
    ],
    regulatory:
      "Walk through an FMEA for the loop — hazard, cause, mitigation, residual risk.",
    tags: ["controls", "embedded", "safety"],
  },
  {
    id: "wearable-firmware",
    title: "Low-power wearable vitals monitor",
    blurb:
      "Battery-driven sensor node that logs vitals for days, with an RTOS and a real power budget.",
    courses: ["ECEN361", "ECEN461", "ECEN260"],
    why: "Wearables live and die on power budgets. Measured microamp-level current profiling is concrete, quantitative evidence of engineering judgment.",
    deliverables: [
      "RTOS task design with measured duty cycles",
      "Sleep-mode current profile and a projected battery life",
      "Wireless sync with retry/backoff",
      "Watchdog and brown-out recovery behavior",
    ],
    regulatory:
      "IEC 62304 software lifecycle: keep a requirements-to-test traceability table, even a small one.",
    tags: ["embedded", "low-power", "firmware"],
  },
  {
    id: "ultrasound-fpga",
    title: "FPGA beamformer for ultrasound",
    blurb:
      "Implement delay-and-sum beamforming across a simulated transducer array in RTL.",
    courses: ["ECEN340", "ECEN351", "ECEN380"],
    why: "Imaging R&D groups need people who can put real DSP into hardware. An RTL beamformer is a strong, uncommon portfolio piece.",
    deliverables: [
      "Verilog delay-and-sum core with parameterized channel count",
      "Testbench driven by simulated echo data",
      "Timing closure report and resource utilization",
      "Reconstructed image from synthetic phantom data",
    ],
    tags: ["fpga", "dsp", "imaging"],
  },
  {
    id: "signal-integrity",
    title: "Mixed-signal PCB with signal-integrity analysis",
    blurb:
      "Lay out a board where a switching supply and a microvolt sensor coexist without ruining each other.",
    courses: ["ECEN299", "ECEN430", "ECEN390"],
    why: "Grounding and return-path decisions are exactly what separates a student board from a product board. Measured noise floors make the case for you.",
    deliverables: [
      "Stack-up and ground strategy with the reasoning documented",
      "Measured noise floor before and after layout changes",
      "Conducted-emissions pre-scan",
      "A written list of what you would change on rev 2",
    ],
    regulatory:
      "IEC 60601-1-2 covers EMC for medical equipment — reference it when discussing emissions.",
    tags: ["pcb", "hardware", "emc"],
  },
  {
    id: "device-data-pipeline",
    title: "Device telemetry pipeline",
    blurb:
      "Ingest, validate, and version streaming data from a fleet of simulated devices.",
    courses: ["DS250", "DS460", "CSE212"],
    why: "Post-market surveillance and clinical-trial data handling are real, growing functions inside device companies, and few EE graduates can speak to them.",
    deliverables: [
      "Ingest with schema validation and quarantine for bad records",
      "Immutable, versioned storage with an audit trail",
      "Dashboards for device-level anomaly rates",
      "Documented data-retention and de-identification approach",
    ],
    regulatory:
      "Touch on 21 CFR Part 11 expectations for electronic records and audit trails.",
    tags: ["data", "software", "post-market"],
  },
  {
    id: "implant-telemetry",
    title: "Short-range implant telemetry link",
    blurb:
      "Design an RF link that works through tissue at a power budget an implant can afford.",
    courses: ["ECEN420", "ECEN390", "ECEN461"],
    why: "Implantable telemetry is a specialized, well-paid niche. Tissue-loss modeling and link budgets show you can reason about a hostile channel.",
    deliverables: [
      "Link budget including tissue attenuation assumptions",
      "Antenna design and measured return loss in a tissue phantom",
      "Bit-error-rate vs. distance measurements",
      "Power-per-bit comparison across two modulation schemes",
    ],
    regulatory:
      "MedRadio band allocation and SAR limits constrain this design — cite them.",
    tags: ["rf", "implant", "wireless"],
  },
  {
    id: "test-fixture",
    title: "Automated test fixture for a device subassembly",
    blurb:
      "Build the bench rig that measures a board against spec and logs every unit.",
    courses: ["ME310", "ECEN299", "CSE111"],
    why: "Every device company runs on test fixtures, and new grads rarely build one. This maps directly onto manufacturing and V&V engineering roles.",
    deliverables: [
      "Instrument control and automated measurement sequence",
      "Pass/fail limits derived from a spec you write first",
      "Per-unit logged results with serial-number traceability",
      "Gauge R&R style repeatability study",
    ],
    regulatory:
      "Design-history-file thinking: the fixture is evidence, so its calibration matters.",
    tags: ["test", "manufacturing", "instrumentation"],
  },
  {
    id: "senior-capstone",
    title: "Capstone framed as a device development project",
    blurb:
      "Run your senior project with the artifacts a device company expects, not just a demo.",
    courses: ["ECEN499", "ECEN397"],
    why: "The same technical work scores far higher in an interview when it comes with requirements, risk analysis, and verification evidence attached.",
    deliverables: [
      "User needs → design inputs → design outputs traceability",
      "Risk analysis with mitigations tracked to closure",
      "Verification protocol and executed results",
      "Design review package",
    ],
    regulatory:
      "This is ISO 13485 / 21 CFR 820.30 design-control structure in miniature — naming it signals industry awareness.",
    tags: ["capstone", "process", "systems"],
  },
];
