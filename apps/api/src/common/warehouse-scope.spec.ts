import { ForbiddenException } from '@nestjs/common';
import {
  assertWarehouseAllowed,
  filterAllowedWarehouses,
  isWarehouseAllowed,
} from './warehouse-scope';

describe('warehouse-scope', () => {
  it('allows any warehouse when scope is null (unrestricted)', () => {
    expect(isWarehouseAllowed({ warehouseScope: null }, 'wh-1')).toBe(true);
  });

  it('allows only listed warehouses when scoped', () => {
    const user = { warehouseScope: ['wh-1', 'wh-2'] };
    expect(isWarehouseAllowed(user, 'wh-1')).toBe(true);
    expect(isWarehouseAllowed(user, 'wh-9')).toBe(false);
  });

  it('assert throws for a disallowed warehouse', () => {
    expect(() => assertWarehouseAllowed({ warehouseScope: ['wh-1'] }, 'wh-2')).toThrow(
      ForbiddenException,
    );
    expect(() => assertWarehouseAllowed({ warehouseScope: null }, 'wh-2')).not.toThrow();
  });

  it('filters a list to allowed warehouses', () => {
    expect(filterAllowedWarehouses({ warehouseScope: ['a', 'c'] }, ['a', 'b', 'c'])).toEqual([
      'a',
      'c',
    ]);
    expect(filterAllowedWarehouses({ warehouseScope: null }, ['a', 'b'])).toEqual(['a', 'b']);
  });
});
