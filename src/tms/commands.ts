// Single entry point for every state-changing command. Routes to the core service
// (Phases 1A/1B), the staff busing module (Phase 2), the staff logistics module
// (Phase 3), the compliance documents module (Phase 6) or the maintenance/readiness
// module (Phase 8). UI code calls executeCommand only.

import { executeBookings, isBookingCommand, type BookingCommand } from "./bookings";
import { executeBusing, isBusingCommand, type BusingCommand } from "./busing";
import { executeCompliance, isComplianceCommand, type ComplianceCommand } from "./compliance";
import { executeContracts, isContractCommand, type ContractCommand } from "./contracts";
import { executeExpenses, isExpenseCommand, type ExpenseCommand } from "./expenses";
import { executeFinance, isFinanceCommand, type FinanceCommand } from "./finance";
import { executeImport, isImportCommand, type ImportCommand } from "./import";
import { executeLogistics, isLogisticsCommand, type LogisticsCommand } from "./logistics";
import { executeMaintenance, isMaintenanceCommand, type MaintenanceCommand } from "./maintenance";
import { executeReceipts, isReceiptCommand, type ReceiptCommand } from "./receipts";
import { executeVehiclePhoto, isVehiclePhotoCommand, type VehiclePhotoCommand } from "./vehiclePhoto";
import { execute, type Actor, type Command, type CommandResult } from "./service";
import type { Database } from "./types";

export type AnyCommand =
  | Command
  | BusingCommand
  | LogisticsCommand
  | ComplianceCommand
  | MaintenanceCommand
  | ImportCommand
  | FinanceCommand
  | ExpenseCommand
  | ContractCommand
  | ReceiptCommand
  | VehiclePhotoCommand
  | BookingCommand;

export function executeCommand(db: Database, actor: Actor | null, command: AnyCommand, now?: string): CommandResult {
  if (isImportCommand(command)) return executeImport(db, actor, command, now);
  if (isBookingCommand(command)) return executeBookings(db, actor, command, now);
  if (isBusingCommand(command)) return executeBusing(db, actor, command, now);
  if (isLogisticsCommand(command)) return executeLogistics(db, actor, command, now);
  if (isComplianceCommand(command)) return executeCompliance(db, actor, command, now);
  if (isMaintenanceCommand(command)) return executeMaintenance(db, actor, command, now);
  if (isFinanceCommand(command)) return executeFinance(db, actor, command, now);
  if (isExpenseCommand(command)) return executeExpenses(db, actor, command, now);
  if (isReceiptCommand(command)) return executeReceipts(db, actor, command, now);
  if (isVehiclePhotoCommand(command)) return executeVehiclePhoto(db, actor, command, now);
  if (isContractCommand(command)) return executeContracts(db, actor, command, now);
  return execute(db, actor, command, now);
}
