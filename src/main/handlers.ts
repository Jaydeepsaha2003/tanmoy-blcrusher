import * as auth from './services/auth'
import * as plants from './services/plants'
import * as locations from './services/stockLocations'
import * as suppliers from './services/suppliers'
import * as customers from './services/customers'
import * as products from './services/products'
import * as rates from './services/rates'
import * as rateChart from './services/rateChart'
import * as purchases from './services/purchases'
import * as psettings from './services/productionSettings'
import * as productions from './services/productions'
import * as finished from './services/finishedGoods'
import * as dispatches from './services/dispatches'
import * as movements from './services/movements'
import * as transporters from './services/transporters'
import * as companies from './services/companies'
import * as racks from './services/racks'
import * as ledgers from './services/ledgers'
import * as assets from './services/assets'
import * as plantExpenses from './services/plantExpenses'
import * as budget from './services/budget'
import * as diesel from './services/diesel'
import * as businesses from './services/businesses'
import * as outsource from './services/outsource'
import * as payroll from './services/payroll'
import * as system from './services/system'
import * as users from './services/users'
import { listActivity } from './services/audit'
import { getDashboard } from './services/dashboard'

/**
 * Map of method name -> handler. Both transports use it:
 *  - Electron desktop: ipcMain.handle('api', ...) in ipc.ts
 *  - Web server: POST /api/call in ../../server/index.ts
 * The renderer calls these the same way through window.api.call / fetch.
 */
export const handlers: Record<string, (payload: any) => unknown> = {
  'auth.login': auth.login,
  'auth.changePassword': auth.changePassword,
  // In the desktop build there is no session, so "me" always reports logged-out
  // and the login screen is shown on launch. The web server overrides this to
  // report the real session state (see server/index.ts).
  'auth.me': () => ({ ok: false }),
  'auth.logout': () => ({ ok: true }),

  'plants.list': plants.listPlants,
  'plants.create': plants.createPlant,
  'plants.update': plants.updatePlant,
  'plants.delete': plants.deletePlant,

  'locations.list': locations.listStockLocations,
  'locations.create': locations.createStockLocation,
  'locations.update': locations.updateStockLocation,
  'locations.delete': locations.deleteStockLocation,

  'suppliers.list': suppliers.listSuppliers,
  'suppliers.create': suppliers.createSupplier,
  'suppliers.update': suppliers.updateSupplier,
  'suppliers.delete': suppliers.deleteSupplier,

  'customers.list': customers.listCustomers,
  'customers.create': customers.createCustomer,
  'customers.update': customers.updateCustomer,
  'customers.delete': customers.deleteCustomer,

  'products.list': products.listProducts,
  'products.create': products.createProduct,
  'products.update': products.updateProduct,
  'products.delete': products.deleteProduct,

  'rates.list': rates.listCustomerRates,
  'rates.save': rates.saveCustomerRates,
  'rates.createShareLink': rates.customerShareLink,
  'rates.removeShareLink': rates.revokeShareLink,
  'rates.getBusinessName': rates.getBusinessName,
  'rates.setBusinessName': rates.setBusinessName,
  'rates.getBranding': rates.getBranding,
  'rates.setLogo': rates.setLogo,

  'rateChart.list': rateChart.listRateChart,
  'rateChart.create': rateChart.createRateChart,
  'rateChart.update': rateChart.updateRateChart,
  'rateChart.delete': rateChart.deleteRateChart,
  'transportCharges.list': rateChart.listTransportCharges,
  'transportCharges.create': rateChart.createTransportCharge,
  'transportCharges.update': rateChart.updateTransportCharge,
  'transportCharges.delete': rateChart.deleteTransportCharge,

  'purchases.list': purchases.listPurchases,
  'purchases.detail': purchases.getPurchaseDetail,
  'purchases.create': purchases.createPurchase,
  'purchases.update': purchases.updatePurchase,
  'purchases.delete': purchases.deletePurchase,
  'purchases.setPayment': purchases.setPurchasePayment,

  'productionSettings.list': psettings.listProductionSettings,
  'productionSettings.save': psettings.saveProductionSettings,

  'productions.list': productions.listProductions,
  'productions.preview': productions.previewProduction,
  'productions.create': productions.createProduction,
  'productions.delete': productions.deleteProduction,

  'finished.list': finished.listFinishedGoods,
  'finished.available': finished.availableProducts,
  'finished.setOpening': finished.setOpening,

  'dispatches.list': dispatches.listDispatches,
  'dispatches.detail': dispatches.getDispatchDetail,
  'dispatches.create': dispatches.createDispatch,
  'dispatches.update': dispatches.updateDispatch,
  'dispatches.setRate': dispatches.setRate,
  'dispatches.setDelivery': dispatches.setDelivery,
  'dispatches.setDispatch': dispatches.setDispatch,
  'dispatches.setPayment': dispatches.setPayment,
  'dispatches.delete': dispatches.deleteDispatch,

  'movements.list': movements.listMovements,
  'movements.transfer': movements.transferStock,
  'movements.deleteTransfer': movements.deleteTransfer,

  'transporters.list': transporters.listTransporters,
  'transporters.create': transporters.createTransporter,
  'transporters.update': transporters.updateTransporter,
  'transporters.delete': transporters.deleteTransporter,

  'companies.list': companies.listCompanies,
  'companies.create': companies.createCompany,
  'companies.update': companies.updateCompany,
  'companies.delete': companies.deleteCompany,

  'racks.list': racks.listRacks,
  'racks.create': racks.createRack,
  'racks.update': racks.updateRack,
  'racks.setStatus': racks.setRackStatus,
  'racks.delete': racks.deleteRack,
  'racks.detail': racks.getRackDetail,
  'racks.addLoading': racks.addLoading,
  'racks.updateLoading': racks.updateLoading,
  'racks.deleteLoading': racks.deleteLoading,
  'racks.addUnloading': racks.addUnloading,
  'racks.updateUnloading': racks.updateUnloading,
  'racks.deleteUnloading': racks.deleteUnloading,
  'racks.expenseTypes': racks.listExpenseTypes,
  'racks.createExpenseType': racks.createExpenseType,
  'racks.deleteExpenseType': racks.deleteExpenseType,
  'racks.addExpense': racks.addExpense,
  'racks.updateExpense': racks.updateExpense,
  'racks.deleteExpense': racks.deleteExpense,
  'racks.listExpenses': racks.listExpenses,
  'racks.addSale': racks.addSale,
  'racks.saleDetail': racks.getSaleDetail,
  'racks.updateSale': racks.updateSale,
  'racks.deleteSale': racks.deleteSale,
  'racks.listSales': racks.listSales,

  'ledgers.get': ledgers.getLedger,
  'ledgers.balances': ledgers.getPartyBalances,
  'ledgers.allDues': ledgers.getAllDues,
  'ledgers.getOpening': ledgers.getOpeningBalance,
  'ledgers.setOpening': ledgers.setOpeningBalance,
  'ledgers.deleteOpening': ledgers.deleteOpeningBalance,

  'assets.list': assets.listAssets,
  'assets.create': assets.createAsset,
  'assets.update': assets.updateAsset,
  'assets.delete': assets.deleteAsset,
  'assets.report': assets.assetReport,

  'businesses.list': businesses.listBusinesses,
  'businesses.create': businesses.createBusiness,
  'businesses.update': businesses.updateBusiness,
  'businesses.delete': businesses.deleteBusiness,

  'outsource.list': outsource.listOutsource,
  'outsource.create': outsource.createOutsource,
  'outsource.update': outsource.updateOutsource,
  'outsource.delete': outsource.deleteOutsource,

  'plantExpenses.list': plantExpenses.listPlantExpenses,
  'plantExpenses.totals': plantExpenses.expenseTotals,
  'plantExpenses.create': plantExpenses.createPlantExpense,
  'plantExpenses.update': plantExpenses.updatePlantExpense,
  'plantExpenses.delete': plantExpenses.deletePlantExpense,

  'budget.get': budget.getBudget,
  'budget.save': budget.saveBudget,

  'diesel.stock': diesel.dieselStock,
  'diesel.purchases': diesel.listDieselPurchases,
  'diesel.createPurchase': diesel.createDieselPurchase,
  'diesel.updatePurchase': diesel.updateDieselPurchase,
  'diesel.deletePurchase': diesel.deleteDieselPurchase,
  'diesel.issues': diesel.listDieselIssues,
  'diesel.createIssue': diesel.createDieselIssue,
  'diesel.updateIssue': diesel.updateDieselIssue,
  'diesel.deleteIssue': diesel.deleteDieselIssue,
  'diesel.byAsset': diesel.issuesByAsset,

  'payments.add': ledgers.addPayment,
  'payments.list': ledgers.listPayments,
  'payments.delete': ledgers.deletePayment,

  'employees.list': payroll.listEmployees,
  'employees.create': payroll.createEmployee,
  'employees.update': payroll.updateEmployee,
  'employees.delete': payroll.deleteEmployee,
  'wages.list': payroll.listWageEntries,
  'wages.workingDays': payroll.getWorkingDays,
  'wages.create': payroll.createWageEntry,
  'wages.update': payroll.updateWageEntry,
  'wages.delete': payroll.deleteWageEntry,

  'system.requestDelete': system.requestDataDeletion,
  'system.cancelDelete': system.cancelDataDeletion,
  'system.deleteStatus': system.deletionStatus,
  'system.getWorkdays': system.getWorkdaySettings,
  'system.setWorkdays': system.setWorkdaySettings,

  'users.list': users.listUsers,
  'users.create': users.createUser,
  'users.update': users.updateUser,
  'users.delete': users.deleteUser,
  'activity.list': listActivity,

  'dashboard.get': getDashboard
}
