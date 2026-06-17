import { GoogleGenAI } from "@google/genai";
import { Product, Sale, PharmacyInfo } from '../types';

/**
 * AI Intelligence Suite using Gemini 3 Flash Preview
 */

const getAI = () => new GoogleGenAI({ apiKey: typeof process !== 'undefined' && process.env ? process.env.API_KEY : (import.meta as any).env?.VITE_API_KEY || 'MISSING_KEY' });

/**
 * Executes a forensic sweep for drug-drug interactions.
 */
export const checkDrugInteractions = async (medicines: string[]): Promise<string> => {
  if (medicines.length < 2) return "At least two medications are required for a clinical safety sweep.";
  const ai = getAI();
  const prompt = `
    You are an expert Clinical Pharmacologist. Analyze the following medication list for potential drug-drug interactions: ${medicines.join(', ')}

    Analyze:
    1. 🔴 MAJOR INTERACTIONS: Life-threatening risks or contraindications.
    2. 🟡 MODERATE INTERACTIONS: Risks requiring dose adjustment or close monitoring.
    3. 🔵 MINOR/SYNERGISTIC: Common side effects or therapeutic enhancements.
    4. 🟢 SUMMARY: A final dispensing recommendation.

    Format: Use professional Markdown with clear headers and emojis for risk levels. Be concise and clinical.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text || "Clinical sweep returned no data.";
  } catch (error) {
    return "Clinical AI service unavailable. Proceed with standard manual contraindication check.";
  }
};

/**
 * NEW: Generates forensic clinical dosing instructions.
 */
export const generateClinicalInstruction = async (params: {
  drugName: string,
  strength: string,
  dosageForm: string,
  indication: string,
  ageGroup: string,
  conditions: string,
  route: string,
  frequency: string,
  duration: string,
  food: string,
  precautions: string,
  targetLanguage: string
}): Promise<string> => {
  const ai = getAI();
  const prompt = `
    Act as a licensed clinical pharmacist and pharmaceutical labeling expert.
    Generate a complete, clear, and patient-safe medication dosing instruction in ${params.targetLanguage}.

    Medication Context:
    - Drug: ${params.drugName} ${params.strength} (${params.dosageForm})
    - Indication: ${params.indication}
    - Patient: ${params.ageGroup} (${params.conditions || 'No special conditions'})
    - Regimen: ${params.route}, ${params.frequency}, for ${params.duration}
    - Food Relation: ${params.food}
    - Precautions: ${params.precautions}

    Required Output (Translated to ${params.targetLanguage}):
    1. PROFESSIONAL PHARMACY LABEL (Short, capitalized, no unsafe abbreviations like QD/BID).
    2. DETAILED PATIENT COUNSELING (Step-by-step route, dose, missed dose logic, storage).
    3. STRUCTURED JSON (For software integration).

    Ensure medical accuracy and regulatory compliance.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text || "Failed to generate instructions.";
  } catch (error) {
    return "Clinical AI Node Error. Manual labeling required.";
  }
};

// Added generateAndTranslateLabel to fix Error in file src/pages/ClinicalAI.tsx on line 7
/**
 * NEW: Generates and translates a medication label for Clinical AI tool.
 */
export const generateAndTranslateLabel = async (drugName: string, targetLanguage: string): Promise<string> => {
  const ai = getAI();
  const prompt = `
    Act as a licensed clinical pharmacist.
    Generate a patient-safe medication label for "${drugName}" in ${targetLanguage}.
    
    Include:
    1. Common Dosage
    2. Primary Indication
    3. Critical Precautions
    4. Storage Instructions
    
    Translate everything to ${targetLanguage}. Use professional Markdown.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text || "Failed to generate label.";
  } catch (error) {
    return "Clinical AI service unavailable.";
  }
};

/**
 * Forensic multi-period financial and operational analysis.
 */
export const analyzeFinancialPeriod = async (
  sales: Sale[],
  products: Product[],
  period: string,
  info: PharmacyInfo
): Promise<string> => {
  const ai = getAI();
  const totalRev = sales.reduce((s, x) => s + x.grandTotal, 0);
  const totalCogs = sales.reduce((sum, sale) => {
    return sum + sale.items.reduce((c, i) => c + (i.buyingPrice * i.cartQty), 0);
  }, 0);

  const prompt = `
    Perform a DEEP FORENSIC OPERATIONAL AUDIT for "${info.name}" for the ${period} cycle.
    
    Data Context:
    - Gross Revenue: ${totalRev.toFixed(2)}
    - Cost of Goods Sold (COGS): ${totalCogs.toFixed(2)}
    - Net Profit Margin: ${totalRev > 0 ? (((totalRev - totalCogs) / totalRev) * 100).toFixed(1) : 0}%
    - Transaction Volume: ${sales.length}
    - Product Density: ${products.length} active SKUs

    Your Task:
    As a Senior Pharmacy Business Consultant, provide a forensic report in Markdown including:
    1. **Profitability Deep-Dive**: Analyze the margin efficiency. Is the COGS too high?
    2. **ABC/FSN Insights**: Explain how the business should handle 'Class A' (High revenue) vs 'Class C' (Low revenue) items. Mention the 'Dead Stock' trap.
    3. **Stock Stabilization**: Identify if the inventory turnover (Demand vs On-Hand) is healthy. 
    4. **Strategic Roadmap**: Three specific, data-driven actions to increase yield for the next cycle.

    Use a professional, clinical, and authoritative tone.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text || "Audit generation failed.";
  } catch (error) {
    return "Operational Intelligence node offline.";
  }
};

export const analyzePrescriptionImage = async () => ({});
export const translateInstruction = async (text: string) => text;