'use client';

import { WorkflowRunner } from '../../../../components/mobile/WorkflowRunner';
import { MobileHeader } from '../../../../components/mobile/MobileHeader';

export default function Page() {
  return (
    <div>
      <MobileHeader back />
      <WorkflowRunner workType="transfers" />
    </div>
  );
}
