sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/m/MessageToast",
	"sap/ui/core/format/NumberFormat"
], function(Controller, JSONModel, Filter, FilterOperator, MessageToast, NumberFormat) {
	"use strict";

	return Controller.extend("Z_Cost_Saving_Report.controller.View1", {
		onInit: function() {
			this.getView().setBusyIndicatorDelay(0);
			this._currency = NumberFormat.getCurrencyInstance({
				currencyCode: false,
				showMeasure: true,
				maxFractionDigits: 2
			});
			this._number = NumberFormat.getFloatInstance({
				maxFractionDigits: 2
			});
			this.getView().setModel(new JSONModel({
				kpis: [],
				tree: [],
				materials: [],
				savingBars: [],
				compareBars: [],
				distribution: {
					items: []
				},
				selectedWbs: "—"
			}), "dash");
			this.byId("statusStrip").setText("Enter a project ID and choose Go.");
		},
		_num: function(v) {
			return Number(v) || 0;
		},
		_money: function(v) {
			return this._currency.format(this._num(v), "INR");
		},
		onGo: function() {
			this._loadProject(this.byId("projectInput").getValue());
		},
		onRefresh: function() {
			this._loadProject(this.byId("projectInput").getValue());
		},
		onReset: function() {
			this.byId("projectInput").setValue("");
			this._modelData = [];
			this._allWbs = [];
			this.getView().getModel("dash").setData({kpis: [], tree: [], materials: [], savingBars: [], compareBars: [], distribution: {items: []}, selectedWbs: "—"});
			this._setStatus("Enter a project ID and choose Go.", "Information");
			this.byId("refreshText").setText("Last Refreshed: —");
		},
		onProjectHelp: function() {
			MessageToast.show("Enter a project ID and choose Go.");
		},
		_loadProject: function(sProject) {
			sProject = (sProject || "").trim();
			if (!sProject) {
				this._setStatus("Enter a project ID to load project data.", "Information");
				return;
			}
			var oModel = this.getOwnerComponent().getModel();
			if (!oModel) {
				console.log("Project service model is unavailable");
				this._setStatus("The project data service is unavailable.", "Error");
				return;
			}
			var aFilters = [new Filter("PROJ_PSPNR", FilterOperator.EQ, sProject)];
			this._setStatus("Loading project " + sProject + "…", "Information");
			this.getView().setBusy(true);
			this._readAll(oModel, aFilters).then(function(aRows) {
				console.log("Project cost records loaded", aRows.length);
				this._renderData(aRows);
				this.getView().setBusy(false);
				this.byId("refreshText").setText("Last Refreshed: " + new Date().toLocaleString());
				this._setStatus(aRows.length ? "Loaded " + aRows.length + " records for project " + sProject + "." : "No records found for project " + sProject + ".", aRows.length ? "Success" : "Warning");
			}.bind(this)).catch(function(e) {
				console.log("Project data request failed", e);
				this.getView().setBusy(false);
				this._setStatus("Unable to load project data. Check the connection and try again.", "Error");
				MessageToast.show("Unable to load project data.");
			}.bind(this));
		},
		_setStatus: function(sText, sType) {
			var oStrip = this.byId("statusStrip");
			oStrip.setText(sText);
			oStrip.setType(sType);
			oStrip.setVisible(true);
		},
		_readAll: function(oModel, aFilters) {
			return new Promise(function(resolve, reject) {
				var aResults = [];

				function read(sUrl) {
					var mParams = {
						filters: aFilters,
						success: function(oData) {
							aResults = aResults.concat(oData.results || []);
							if (oData.__next) {
								read(oData.__next);
							} else {
								resolve(aResults);
							}
						},
						error: reject
					};
					if (sUrl) {
						oModel.read(sUrl, mParams);
					} else {
						oModel.read("/ZCOST_SAVING_DDIC_TYPESet", mParams);
					}
				}
				read();
			});
		},
		_renderData: function(aRows) {
			var mWbs = Object.create(null),
				nBoq = 0,
				nPo = 0,
				nAvailability = 0,
				nSaving = 0;
			aRows.forEach(function(r) {
				var sWbs = r.WBS || "(No WBS)",
					w = mWbs[sWbs] || (mWbs[sWbs] = {
						id: sWbs,
						rows: [],
						boq: 0,
						po: 0,
						availability: 0,
						saving: 0
					});
				var nB = this._num(r.BOQ_AMOUNT),
					nP = this._num(r.POAMT),
					nA = this._num(r.AVAILABILITY),
					nS = this._num(r.SAVING);
				w.rows.push(r);
				w.boq += nB;
				w.po += nP;
				w.availability += nA;
				w.saving += nS;
				nBoq += nB;
				nPo += nP;
				nAvailability += nA;
				nSaving += nS;
			}, this);
			var aWbs = Object.keys(mWbs).map(function(k) {
				return mWbs[k];
			}).sort(function(a, b) {
				return b.saving - a.saving;
			});
			this._allWbs = aWbs;
			this._modelData = aRows;
			this._setDashboard(aWbs, aRows, nBoq, nPo, nAvailability, nSaving);
		},
		_setDashboard: function(aWbs, aRows, nBoq, nPo, nAvailability, nSaving) {
			var o = this.getView().getModel("dash"),
				nOriginal = aRows.length ? this._num(aRows[0].ORGINAL_BBU_AMOUNT) : 0,
				nUpdated = aRows.length ? this._num(aRows[0].UPDATED_BBU_AMOUNT) : 0;
			var aTree = aWbs.map(function(w) {
				return {
					title: w.id,
					info: w.rows.length + " items",
					wbs: w.id,
					children: w.rows.map(function(r) {
						return {
							title: r.SERVICE_OR_MATERIAL,
							info: this._money(r.SAVING),
							wbs: w.id,
							material: r.SERVICE_OR_MATERIAL
						};
					}, this)
				};
			}, this);
			var aBars = aWbs.slice(0, this._topCount || 10),
				nMax = Math.max.apply(null, aBars.map(function(w) {
					return Math.abs(w.saving);
				}).concat([1]));
			o.setProperty("/kpis", [{
				label: "Total WBS",
				value: aWbs.length,
				sub: "WBS elements",
				icon: "sap-icon://org-chart"
			}, {
				label: "Total Materials",
				value: aRows.length,
				sub: "Material / service records",
				icon: "sap-icon://product"
			}, {
				label: "Original BBU",
				value: this._money(nOriginal),
				sub: "Project baseline",
				icon: "sap-icon://database"
			}, {
				label: "Updated BBU",
				value: this._money(nUpdated),
				sub: "Current BBU",
				icon: "sap-icon://database"
			}, {
				label: "BOQ Amount",
				value: this._money(nBoq),
				sub: "Bill of quantity",
				icon: "sap-icon://document"
			}, {
				label: "PO Amount",
				value: this._money(nPo),
				sub: "Purchase orders",
				icon: "sap-icon://cart"
			}, {
				label: "Availability",
				value: this._money(nAvailability),
				sub: "Backend value",
				icon: "sap-icon://shipping-status"
			}, {
				label: "Total Saving",
				value: this._money(nSaving),
				sub: "Backend value",
				icon: "sap-icon://trend-up"
			}]);
			o.setProperty("/tree", aTree);
			o.setProperty("/savingBars", aBars.map(function(w) {
				return {
					label: w.id,
					amount: this._money(w.saving),
					width: (Math.max(2, Math.abs(w.saving) / nMax * 100)) + "%"
				};
			}, this));
			o.setProperty("/compareBars", aWbs.slice(0, 6).map(function(w) {
				var top = Math.max(w.boq, w.po, 1);
				return {
					label: w.id,
					boqHeight: Math.max(w.boq / top * 100, 2) + "%",
					poHeight: Math.max(w.po / top * 100, 2) + "%",
					boqShort: this._compact(w.boq),
					poShort: this._compact(w.po)
				};
			}, this));
			o.setProperty("/distribution", {
				items: [{
					label: "BOQ Amount",
					value: this._money(nBoq)
				}, {
					label: "PO Amount",
					value: this._money(nPo)
				}, {
					label: "Availability",
					value: this._money(nAvailability)
				}, {
					label: "Saving",
					value: this._money(nSaving)
				}]
			});
			o.setProperty("/selectedWbs", aWbs.length ? aWbs[0].id : "—");
			this._showWbs(aWbs[0]);
		},
		_compact: function(n) {
			return "₹ " + (n / 10000000).toFixed(2) + " Cr";
		},
		_showWbs: function(w) {
			var rows = w ? w.rows : this._modelData || [];
			this.getView().getModel("dash").setProperty("/materials", rows.map(function(r) {
				return Object.assign({}, r, {
					boqFmt: this._money(r.BOQ_AMOUNT),
					poFmt: this._money(r.POAMT),
					availabilityFmt: this._money(r.AVAILABILITY),
					savingFmt: this._money(r.SAVING)
				});
			}, this));
		},
		onWbsSelect: function(e) {
			var item = e.getParameter("listItem"),
				ctx = item && item.getBindingContext("dash"),
				w = ctx && this._allWbs.find(function(x) {
					return x.id === ctx.getProperty("wbs");
				});
			if (w) {
				this.byId("wbsTree").removeSelections(true);
				this.getView().getModel("dash").setProperty("/selectedWbs", w.id);
				this._showWbs(w);
			}
		},
		onTopChange: function(e) {
			var k = e.getParameter("selectedItem").getKey(),
				a = this._modelData || [],
				nBoq = 0,
				nPo = 0,
				nAv = 0,
				nSv = 0;
			this._topCount = k === "all" ? this._allWbs.length : Number(k);
			a.forEach(function(r) {
				nBoq += this._num(r.BOQ_AMOUNT);
				nPo += this._num(r.POAMT);
				nAv += this._num(r.AVAILABILITY);
				nSv += this._num(r.SAVING);
			}, this);
			this._setDashboard(this._allWbs, a, nBoq, nPo, nAv, nSv);
		},
		onExpandAll: function() {
			this.byId("wbsTree").expandToLevel(2);
		},
		onCollapseAll: function() {
			this.byId("wbsTree").collapseAll();
		},
		onSearch: function(e) {
			var b = this.byId("wbsTree").getBinding("items"),
				q = e.getParameter("newValue");
			b.filter(q ? [new Filter("title", FilterOperator.Contains, q)] : []);
		},
		onMaterialSelect: function(e) {
			var r = e.getSource().getBindingContext("dash").getObject();
			MessageToast.show(r.SERVICE_OR_MATERIAL + " · BOQ " + this._money(r.BOQ_AMOUNT) + " · PO " + this._money(r.POAMT));
		},
		onExport: function() {
			var rows = this._modelData || [],
				head = ["WBS", "Material / Service", "G/L Account", "BOQ Qty", "BOQ Rate", "BOQ Amount", "PO Qty", "PO Rate", "PO Amount",
					"Availability", "Saving"
				];
			var lines = [head].concat(rows.map(function(r) {
				return [r.WBS, r.SERVICE_OR_MATERIAL, r.GL_ACCOUNT, r.BOQ_QTY, r.BOQ_RATE, r.BOQ_AMOUNT, r.PO_QTY, r.PO_RATE, r.POAMT, r.AVAILABILITY,
					r.SAVING
				];
			}));
			var csv = lines.map(function(a) {
				return a.map(function(v) {
					return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
				}).join(",");
			}).join("\r\n");
			var blob = new Blob(["\ufeff" + csv], {
					type: "text/csv;charset=utf-8;"
				}),
				url = URL.createObjectURL(blob),
				link = document.createElement("a");
			link.href = url;
			link.download = "project-cost-saving.csv";
			link.click();
			URL.revokeObjectURL(url);
		}
	});
});
