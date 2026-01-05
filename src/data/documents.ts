export interface QuestDocument {
  id: string;
  title: string;
  description: string;
  imageUrl: string; // Path from /public
  stage: number; // Which stage reveals this document
  votesAwarded: number; // Votes gained when collected
}

export const QUEST_DOCUMENTS: QuestDocument[] = [
  {
    id: 'carta-esino',
    title: 'Carta de Esino (970)',
    description: "Documento originale che prova l'unità storica dei due borghi.",
    imageUrl: '/documents/carta-esino.png',
    stage: 1,
    votesAwarded: 100
  },
  {
    id: 'decreto-segretissimo',
    title: 'Decreto Segretissimo (1340)',
    description: 'Il documento falsificato che ha diviso i due borghi.',
    imageUrl: '/documents/decreto-segretissimo.png',
    stage: 2,
    votesAwarded: 150
  }
];

export const getDocumentsByStage = (stage: number) =>
  QUEST_DOCUMENTS.filter((doc) => doc.stage === stage);

export const getDocumentByStage = (stage: number) =>
  QUEST_DOCUMENTS.find((doc) => doc.stage === stage);

export const getDocumentById = (id: string) =>
  QUEST_DOCUMENTS.find((doc) => doc.id === id);
