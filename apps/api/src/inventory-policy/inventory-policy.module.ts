import { Module } from '@nestjs/common';
import { InventoryPolicyController } from './inventory-policy.controller';
import { InventoryPolicyService } from './inventory-policy.service';
import { ReorderAssessmentService } from './reorder-assessment.service';

@Module({
  controllers: [InventoryPolicyController],
  providers: [InventoryPolicyService, ReorderAssessmentService],
  exports: [InventoryPolicyService, ReorderAssessmentService],
})
export class InventoryPolicyModule {}
