import { checkBin } from '@imbc/contracts';
import { DILIGENCE_CATALOG } from './catalog.js';
import { InvalidDiligenceEvidence, type DiligenceConnectorRun } from './scoring.js';

export interface DiligenceConnector {
  readonly code: 'adata' | 'accounting' | 'legal_entity_registry';
  readonly isMock: boolean;
  run(bin: string): Promise<DiligenceConnectorRun>;
}
export type MockDiligenceCase = 'green' | 'amber' | 'red' | 'unavailable';

/** EXT-04/05: explicit test provenance, no transport or guessed provider data. */
export class MockDiligenceConnector implements DiligenceConnector {
  readonly isMock = true;
  constructor(
    readonly code: 'accounting' | 'legal_entity_registry',
    private readonly fixture: MockDiligenceCase,
  ) {}

  async run(bin: string): Promise<DiligenceConnectorRun> {
    if (!checkBin(bin).valid) throw new InvalidDiligenceEvidence('invalid_connector_bin');
    if (!['green', 'amber', 'red', 'unavailable'].includes(this.fixture))
      throw new InvalidDiligenceEvidence('invalid_mock_case');
    if (this.fixture === 'unavailable') return { state: 'unavailable', isTestData: true };
    const definition = DILIGENCE_CATALOG.find(
      (row) => row.title === (this.fixture === 'amber' ? 'Mass registration address' : 'Bankrupt'),
    )!;
    return {
      state: 'received',
      isTestData: true,
      evidence: [
        {
          group: definition.group,
          subjectIndex: 0,
          subjectName: 'Synthetic connector company',
          sourceOrder: 0,
          catalogId: definition.id,
          checkName: definition.title,
          kind: 'boolean',
          value: this.fixture !== 'green',
        },
      ],
    };
  }
}
