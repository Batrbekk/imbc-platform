import { Injectable } from '@nestjs/common';
import type { Database } from '../../database/database.module.js';
import { rebuildVerifiedCatalogProjection } from '../due-diligence/catalog-projection.js';
import type { SurveyPublication, SurveyPublicationObservation } from './survey-operation.js';
import { observeSiteSurveyPublication } from './survey-publication-state.js';
import type { SiteSurveyScope } from './survey-state.js';

@Injectable()
export class SiteSurveyPublicationService implements SurveyPublication {
  observeBeforeMutation(tx: Database, scope: SiteSurveyScope): Promise<SurveyPublicationObservation> {
    return observeSiteSurveyPublication(tx, scope);
  }
  async refreshAfterMutation(tx: Database, scope: SiteSurveyScope, observation: SurveyPublicationObservation): Promise<void> {
    await rebuildVerifiedCatalogProjection(tx, scope, observation);
  }
}
