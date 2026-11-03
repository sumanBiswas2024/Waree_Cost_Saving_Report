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
			this.getView().setModel(new JSONModel({
				kpis: [],
				serials: [],
				savingBars: [],
				compareBars: [],
				distribution: {
					items: []
				},
				grandTotal: {},
				status: "",
				hasData: false,
				emptyMessage: "No project data. Enter a project ID and choose Go."
			}), "dash");
			this.byId("statusStrip").setText("Enter a project ID and choose Go.");
		},
		_num: function(v) {
			return Number(v) || 0;
		},
		_money: function(v) {
			return this._currency.format(this._num(v), "INR");
		},
		_compact: function(v) {
			return "₹ " + (this._num(v) / 10000000).toFixed(2) + " Cr";
		},
		onGo: function() {
			this._loadProject(this.byId("projectInput").getValue());
		},
		onRefresh: function() {
			this._loadProject(this.byId("projectInput").getValue());
		},
		onReset: function() {
			this.byId("projectInput").setValue("");
			this._rows = [];
			this.getView().getModel("dash").setData({
				kpis: [],
				serials: [],
				savingBars: [],
				compareBars: [],
				distribution: {
					items: []
				},
				grandTotal: {},
				status: "",
				hasData: false,
				emptyMessage: "No project data. Enter a project ID and choose Go."
			});
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
			this.getView().getModel("dash").setData({kpis: [], serials: [], savingBars: [], compareBars: [], distribution: {items: []}, grandTotal: {}, hasData: false, emptyMessage: "Loading project data…"});
			this._setStatus("Loading project " + sProject + "…", "Information");
			this.getView().setBusy(true);
			this._readAll(oModel, [new Filter("PROJ_PSPNR", FilterOperator.EQ, sProject)]).then(function(aRows) {
				console.log("Project cost records loaded", aRows.length);
				this._renderData(aRows);
				this.getView().setBusy(false);
				this.byId("refreshText").setText("Last Refreshed: " + new Date().toLocaleString());
				this._setStatus(aRows.length ? "Loaded " + aRows.length + " records for project " + sProject +
					". The descriptive WBS label is not present in this response; the table shows the backend WBS value." :
					"No records found for project " + sProject + ".", aRows.length ? "Information" : "Warning");
			}.bind(this)).catch(function(e) {
				console.log("Project data request failed", e);
				this.getView().setBusy(false);
				this.getView().getModel("dash").setProperty("/emptyMessage", "Unable to load project data. Check the connection and try again.");
				this._setStatus("Unable to load project data. Check the connection and try again.", "Error");
				MessageToast.show("Unable to load project data.");
			}.bind(this));
		},
		_setStatus: function(sText, sType) {
			var strip = this.byId("statusStrip");
			strip.setText(sText);
			strip.setType(sType);
			strip.setVisible(true);
		},
		_readAll: function(oModel, aFilters) {
			return new Promise(function(resolve, reject) {
				var rows = [];

				function read(sUrl) {
					oModel.read(sUrl || "/ZCOST_SAVING_DDIC_TYPESet", {
						filters: sUrl ? undefined : aFilters,
						success: function(data) {
							rows = rows.concat(data.results || []);
							data.__next ? read(data.__next) : resolve(rows);
						},
						error: reject
					});
				}
				read();
			});
		},
		_renderData: function(rows) {
			this._rows = rows;
			var groups = Object.create(null),
				sums = {
					boq: 0,
					po: 0,
					availability: 0,
					saving: 0
				};
			rows.forEach(function(r) {
				var key = [r.BBU_SERIAL, r.BBU_VERSION, r.PROJ_PSPNR].join("|");
				var g = groups[key] || (groups[key] = {
					key: key,
					serial: r.BBU_SERIAL,
					version: r.BBU_VERSION,
					project: r.PROJ_PSPNR,
					wbs: r.WBS || "",
					materials: [],
					boq: 0,
					po: 0,
					availability: 0,
					saving: 0
				});
				g.materials.push(r);
				g.boq += this._num(r.BOQ_AMOUNT);
				g.po += this._num(r.POAMT);
				g.availability += this._num(r.AVAILABILITY);
				g.saving += this._num(r.SAVING);
				sums.boq += this._num(r.BOQ_AMOUNT);
				sums.po += this._num(r.POAMT);
				sums.availability += this._num(r.AVAILABILITY);
				sums.saving += this._num(r.SAVING);
			}, this);
			var serials = Object.keys(groups).map(function(k) {
				return groups[k];
			});
			this._serials = serials;
			this._totals = sums;
			this._publish(serials, sums);
		},
		_publish: function(groups, sums) {
			var model = this.getView().getModel("dash"),
				rows = this._rows || [],
				first = rows[0] || {},
				self = this;
			var serials = groups.map(function(g) {
				var max = Math.max.apply(null, g.materials.map(function(r) {
					return Math.max(self._num(r.BOQ_AMOUNT), self._num(r.POAMT));
				}).concat([1]));
				return Object.assign({}, g, {
					materialCount: g.materials.length,
					chartWidth: Math.max(520, g.materials.length * 92) + "px",
					boqFmt: self._money(g.boq),
					poFmt: self._money(g.po),
					availabilityFmt: self._money(g.availability),
					savingFmt: self._money(g.saving),
					expanded: !!g.expanded,
					materials: g.materials.map(function(r) {
						return Object.assign({}, r, {
							boqFmt: self._money(r.BOQ_AMOUNT),
							poFmt: self._money(r.POAMT),
							availabilityFmt: self._money(r.AVAILABILITY),
							savingFmt: self._money(r.SAVING)
						});
					}),
					compareBars: g.materials.map(function(r) {
						return {
							label: r.SERVICE_OR_MATERIAL,
							boqHeight: Math.max(self._num(r.BOQ_AMOUNT) / max * 100, 2) + "%",
							poHeight: Math.max(self._num(r.POAMT) / max * 100, 2) + "%",
							boqShort: self._compact(r.BOQ_AMOUNT),
							poShort: self._compact(r.POAMT)
						};
					}),
					savingBars: g.materials.slice().sort(function(a, b) {
						return self._num(b.SAVING) - self._num(a.SAVING);
					}).map(function(r) {
						var top = Math.max.apply(null, g.materials.map(function(x) {
							return Math.abs(self._num(x.SAVING));
						}).concat([1]));
						return {
							label: r.SERVICE_OR_MATERIAL,
							amount: self._money(r.SAVING),
							width: Math.max(2, Math.abs(self._num(r.SAVING)) / top * 100) + "%",
							negative: self._num(r.SAVING) < 0,
							state: self._num(r.SAVING) < 0 ? "Error" : "Success"
						};
					})
				});
			});
			var sorted = groups.slice().sort(function(a, b) {
				return b.saving - a.saving;
			});
			model.setData({
				kpis: [{
					label: "Serial Groups",
					value: groups.length,
					sub: "Serial / version / project",
					icon: "sap-icon://org-chart"
				}, {
					label: "Total Materials",
					value: rows.length,
					sub: "Material / service records",
					icon: "sap-icon://product"
				}, {
					label: "Original BBU",
					value: this._money(first.ORGINAL_BBU_AMOUNT),
					sub: "Backend value",
					icon: "sap-icon://database"
				}, {
					label: "Updated BBU",
					value: this._money(first.UPDATED_BBU_AMOUNT),
					sub: "Backend value",
					icon: "sap-icon://database"
				}, {
					label: "BOQ Amount",
					value: this._money(sums.boq),
					sub: "Material records",
					icon: "sap-icon://document"
				}, {
					label: "PO Amount",
					value: this._money(sums.po),
					sub: "Material records",
					icon: "sap-icon://cart"
				}, {
					label: "Availability",
					value: this._money(sums.availability),
					sub: "Backend values",
					icon: "sap-icon://shipping-status"
				}, {
					label: "Total Saving",
					value: this._money(sums.saving),
					sub: "Backend values",
					icon: "sap-icon://trend-up"
				}],
				serials: serials,
				savingBars: sorted.slice(0, this._topCount || 10).map(function(g) {
					return {
						label: g.serial,
						amount: this._money(g.saving),
						width: Math.max(2, Math.abs(g.saving) / Math.max.apply(null, sorted.map(function(x) {
							return Math.abs(x.saving);
						}).concat([1])) * 100) + "%"
					};
				}, this),
				compareBars: sorted.slice(0, 6).map(function(g) {
					var max = Math.max(g.boq, g.po, 1);
					return {
						label: g.serial,
						boqHeight: Math.max(g.boq / max * 100, 2) + "%",
						poHeight: Math.max(g.po / max * 100, 2) + "%",
						boqShort: this._compact(g.boq),
						poShort: this._compact(g.po)
					};
				}, this),
				distribution: {
					items: [{
						label: "BOQ Amount",
						value: this._money(sums.boq)
					}, {
						label: "PO Amount",
						value: this._money(sums.po)
					}, {
						label: "Availability",
						value: this._money(sums.availability)
					}, {
						label: "Saving",
						value: this._money(sums.saving)
					}]
				},
				grandTotal: {
					boqFmt: this._money(sums.boq),
					poFmt: this._money(sums.po),
					availabilityFmt: this._money(sums.availability),
					savingFmt: this._money(sums.saving)
				},
				hasData: rows.length > 0,
				emptyMessage: rows.length ? "" : "No data found for this project."
			});
		},
		onToggleSerial: function(e) {
			var context = e.getSource().getBindingContext("dash"),
				path = context.getPath(),
				expanded = context.getProperty("expanded");
			this.getView().getModel("dash").setProperty(path + "/expanded", !expanded);
		},
		onExpandAll: function() {
			this.getView().getModel("dash").getProperty("/serials").forEach(function(g, i) {
				this.getView().getModel("dash").setProperty("/serials/" + i + "/expanded", true);
			}, this);
		},
		onCollapseAll: function() {
			this.getView().getModel("dash").getProperty("/serials").forEach(function(g, i) {
				this.getView().getModel("dash").setProperty("/serials/" + i + "/expanded", false);
			}, this);
		},
		onTopChange: function(e) {
			var groups = this._serials || [];
			this._topCount = e.getParameter("selectedItem").getKey() === "all" ? groups.length : Number(e.getParameter("selectedItem").getKey());
			if (this._totals) {
				this._publish(groups, this._totals);
			}
		},
		onSearch: function(e) {
			var q = (e.getParameter("newValue") || "").toLowerCase(),
				groups = this._serials || [];
			var filtered = groups.filter(function(g) {
				return !q || [g.serial, g.version, g.project, g.wbs].join(" ").toLowerCase().indexOf(q) >= 0 || g.materials.some(function(r) {
					return (r.SERVICE_OR_MATERIAL || "").toLowerCase().indexOf(q) >= 0;
				});
			});
			if (this._totals) {
				this._publish(filtered, this._totals);
			}
		},
		onMaterialSelect: function(e) {
			var r = e.getSource().getBindingContext("dash").getObject();
			MessageToast.show(r.SERVICE_OR_MATERIAL + " · BOQ " + this._money(r.BOQ_AMOUNT) + " · PO " + this._money(r.POAMT));
		},
		onExport: function() {
			var rows = this._rows || [],
				head = ["Serial Number", "Version", "Project ID", "WBS", "Material / Service", "G/L Account", "BOQ Qty", "BOQ Rate", "BOQ Amount",
					"PO Qty", "PO Rate", "PO Amount", "Availability", "Saving"
				];
			var lines = [head].concat(rows.map(function(r) {
				return [r.BBU_SERIAL, r.BBU_VERSION, r.PROJ_PSPNR, r.WBS, r.SERVICE_OR_MATERIAL, r.GL_ACCOUNT, r.BOQ_QTY, r.BOQ_RATE, r.BOQ_AMOUNT,
					r.PO_QTY, r.PO_RATE, r.POAMT, r.AVAILABILITY, r.SAVING
				];
			}));
			var csv = lines.map(function(a) {
					return a.map(function(v) {
						return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
					}).join(",");
				}).join("\r\n"),
				blob = new Blob(["\ufeff" + csv], {
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
