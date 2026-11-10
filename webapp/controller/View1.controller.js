sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/m/MessageToast",
	"sap/ui/core/format/NumberFormat",
	"sap/ui/core/Locale",
	"sap/viz/ui5/controls/Popover",
	"sap/m/SelectDialog",
	"sap/m/StandardListItem"
], function(Controller, JSONModel, Filter, FilterOperator, MessageToast, NumberFormat, Locale, VizPopover, SelectDialog, StandardListItem) {
	"use strict";

	var SAVING_TITLE = "WBS-wise Saving";

	function emptyDash(message) {
		return {
			kpis: [],
			wbsGroups: [],
			projectSavingData: [],
			allWbsSavingData: [],
			projectChartData: [],
			projectChartWidth: "100%",
			projectSavingWidth: "100%",
			savingChartTitle: SAVING_TITLE + " (Top 10)",
			hasData: false,
			emptyMessage: message
		};
	}

	return Controller.extend("Z_Cost_Saving_Report.controller.View1", {

		/* ============================================================ */
		/* Lifecycle                                                    */
		/* ============================================================ */
		onInit: function() {
			this.getView().setBusyIndicatorDelay(0);
			var locale = new Locale("en-IN");
			this._moneyFormat = NumberFormat.getFloatInstance({
				groupingEnabled: true,
				minFractionDigits: 2,
				maxFractionDigits: 2
			}, locale);
			this._rateFormat = NumberFormat.getFloatInstance({
				groupingEnabled: true,
				maxFractionDigits: 2
			}, locale);
			this._quantityFormat = NumberFormat.getFloatInstance({
				groupingEnabled: true,
				maxFractionDigits: 3
			}, locale);
			this._topCount = 10;
			this._resetState();
			this.getView().setModel(new JSONModel(emptyDash("No project data. Enter a project ID and choose Go.")), "dash");
			this._setStatus("Enter a project ID and choose Go.", "Information");
		},

		/* ============================================================ */
		/* Small helpers                                                */
		/* ============================================================ */
		_resetState: function() {
			this._rows = [];
			this._allWbs = [];
			this._visibleWbs = [];
			this._filteredRows = [];
		},
		_validateProject: function(projectId) {
			var input = this.byId("projectInput"),
				value = (projectId || "").trim();
			input.setValueState("None");
			input.setValueStateText("");
			if (!value) {
				input.setValueState("Error");
				input.setValueStateText("Select or enter a project ID.");
				this._setStatus("Select or enter a project ID before choosing Go.", "Error");
				return null;
			}
			if (value.length > 24) {
				input.setValueState("Error");
				input.setValueStateText("Project ID must be 24 characters or fewer.");
				this._setStatus("Project ID must be 24 characters or fewer.", "Error");
				return null;
			}
			return value;
		},
		_num: function(value) {
			return Number(value) || 0;
		},
		_money: function(value) {
			return "₹ " + this._moneyFormat.format(this._num(value) / 100000) + " L";
		},
		_rate: function(value) {
			return "₹ " + this._rateFormat.format(this._num(value));
		},
		_quantity: function(value) {
			return this._quantityFormat.format(this._num(value));
		},
		_setStatus: function(text, type) {
			var strip = this.byId("statusStrip");
			strip.setText(text);
			strip.setType(type);
			strip.setVisible(true);
		},
		_dash: function() {
			return this.getView().getModel("dash");
		},

		/* ============================================================ */
		/* Toolbar actions                                              */
		/* ============================================================ */
		onGo: function() {
			this._loadProject(this.byId("projectInput").getValue());
		},
		onKpiPress: function(event) {
			var context = event.getSource().getBindingContext("dash");
			if (!context || context.getProperty("label") !== "Total Saving") { return; }
			if (!this._dash().getProperty("/allWbsSavingData").length) {
				MessageToast.show("There are no non-zero WBS saving amounts to chart.");
				return;
			}
			this.byId("allSavingDialog").open();
			this._resizeVisibleCharts();
		},
		onCloseSavingChart: function() {
			this.byId("allSavingDialog").close();
		},
		onRefresh: function() {
			this._loadProject(this.byId("projectInput").getValue());
		},
		onReset: function() {
			this.byId("projectInput").setValue("").setValueState("None").setValueStateText("");
			this._resetState();
			this._dash().setData(emptyDash("No project data. Enter a project ID and choose Go."));
			this._setStatus("Enter a project ID and choose Go.", "Information");
			this.byId("refreshText").setText("Last Refreshed: —");
		},
		onProjectHelp: function() {
			var model = this.getOwnerComponent().getModel();
			if (!model) {
				var unavailable = "The project value help service is unavailable.";
				this._setStatus(unavailable, "Error");
				MessageToast.show(unavailable);
				return;
			}
			if (!this._projectHelpDialog) {
				var dialog = new SelectDialog({
					title: "Select Project",
					noDataText: "No projects are available.",
					growingThreshold: 100,
					rememberSelections: false,
					items: {
						path: "projectHelp>/WBSList",
						template: new StandardListItem({ title: "{projectHelp>WBS}", type: "Active" })
					},
					search: function(event) { this._filterProjectHelp(event.getParameter("value") || "", event.getParameter("itemsBinding")); }.bind(this),
					liveChange: function(event) {
						var query = event.getParameter("value") || "";
						clearTimeout(this._projectHelpSearchTimer);
						this._projectHelpSearchTimer = setTimeout(function() {
							this._filterProjectHelp(query || "");
						}.bind(this), 300);
					}.bind(this),
					confirm: function(event) {
						var item = event.getParameter("selectedItem");
						if (item) {
							this.byId("projectInput").setValue(item.getTitle()).setValueState("None");
							this._loadProject(item.getTitle());
						}
					}.bind(this)
				});
				dialog.setModel(new JSONModel({ WBSList: [] }), "projectHelp");
				this.getView().addDependent(dialog);
				this._projectHelpDialog = dialog;
			}
			clearTimeout(this._projectHelpSearchTimer);
			this._filterProjectHelp("");
			this._projectHelpDialog.open("");
			if (!this._projectChoicesLoaded && !this._projectChoicesLoading) {
				this._loadProjectChoices(model);
			}
		},
		_loadProjectChoices: function(model) {
			this._projectChoicesLoading = true;
			this._projectHelpDialog.setBusy(true);
			model.read("/ZWBSF4", {
				urlParameters: { "$select": "WBS" },
				success: function(data) {
					var seen = Object.create(null),
						items = (data.results || []).reduce(function(result, row) {
							var value = (row.WBS || "").trim();
							if (value && !seen[value]) {
								seen[value] = true;
								result.push({ WBS: value });
							}
							return result;
						}, []);
					this._projectHelpDialog.getModel("projectHelp").setProperty("/WBSList", items);
					this._projectChoicesLoaded = true;
					this._projectChoicesLoading = false;
					this._projectHelpDialog.setBusy(false);
				}.bind(this),
				error: function(error) {
					this._projectChoicesLoading = false;
					this._projectHelpDialog.setBusy(false);
					var details = this._readBackendError(error);
					var message = details.message || "Could not load project choices. Check the service and try again.";
					this._setStatus(message, "Error");
					MessageToast.show(message);
				}.bind(this)
			});
		},
		_filterProjectHelp: function(query, binding) {
			binding = binding || (this._projectHelpDialog && this._projectHelpDialog.getBinding("items"));
			if (!binding) { return; }
			query = (query || "").trim();
			var filters = query ? [new Filter("WBS", FilterOperator.Contains, query)] : [];
			binding.filter(filters);
		},

		/* ============================================================ */
		/* Charts                                                       */
		/* ============================================================ */
		// Width is handled purely by layout (CSS min-width:100% + px width from the model),
		// so no DOM measuring / resize listeners are needed. This handler only applies the
		// one-time viz configuration and connects the popover.
		onChartRenderComplete: function(event) {
			this._configureVizFrame(event.getSource());
		},
		onChartZoomIn: function(event) {
			this._zoomChart(event.getSource(), "in");
		},
		onChartZoomOut: function(event) {
			this._zoomChart(event.getSource(), "out");
		},
		_zoomChart: function(container, direction) {
			var chartContainer = container.getSource ? container.getSource() : container;
			while (chartContainer && !(chartContainer.isA && chartContainer.isA("sap.suite.ui.commons.ChartContainer"))) {
				chartContainer = chartContainer.getParent && chartContainer.getParent();
			}
			if (!chartContainer) {
				return;
			}
			var frames = chartContainer.findAggregatedObjects(true, function(control) {
				return control.isA && control.isA("sap.viz.ui5.controls.VizFrame");
			});
			if (frames.length && typeof frames[0].zoom === "function") {
				frames[0].zoom({
					direction: direction
				});
			}
		},
		_configureVizFrame: function(frame) {
			var isSaving = frame.hasStyleClass("savingViz") || frame.hasStyleClass("materialSavingViz") ||
				frame.hasStyleClass("allWbsSavingViz");
			if (!frame.data("vizConfigured")) {
				frame.data("vizConfigured", true);
				var props = {
					title: {
						visible: false
					},
					legend: {
						visible: true
					},
					legendGroup: {
						layout: {
							position: "right"
						}
					},
					categoryAxis: {
						title: {
							visible: false
						},
						label: {
							visible: true,
							angle: 0
						}
					},
					valueAxis: {
						title: {
							visible: true,
							text: isSaving ? "Saving (₹ L)" : "Amount (₹ L)"
						}
					}
				};
				if (isSaving) {
					props.plotArea = {
						dataLabel: {
							visible: true,
							hideWhenOverlap: false,
							position: "outside",
							formatString: "#,##0.0"
						},
						dataPointStyle: {
							rules: [{
								dataContext: { "Saving Type": "Positive" },
								properties: { color: "#16834A" },
								displayName: "Saving"
							}, {
								dataContext: { "Saving Type": "Negative" },
								properties: { color: "#D64545" },
								displayName: "Overrun"
							}]
						}
					};
				} else {
					props.plotArea = {
						dataLabel: {
							visible: true,
							hideWhenOverlap: false,
							position: "outside",
							formatString: "#,##0.0"
						},
						colorPalette: ["#F39A22", "#16834A"]
					};
				}
				frame.setVizProperties(props);
			}
			if (!frame.data("popoverConnected")) {
				frame.data("popoverConnected", true);
				var popover = new VizPopover({});
				this.getView().addDependent(popover);
				popover.connect(frame.getVizUid());
			}
			// ChartContainer moves its content into a fullscreen overlay. Keep the VizFrame
			// dimensions in step with that content area instead of leaving the original
			// card-sized fixed height in place.
			if (!frame._chartResizeObserver && typeof ResizeObserver !== "undefined") {
				var viewport = frame.getDomRef() && frame.getDomRef().closest(".chartViewport");
				var containerDom = frame.getDomRef() && frame.getDomRef().closest(".suiteChartContainer");
				if (viewport && containerDom) {
					var observer = new ResizeObserver(function() {
						var fullHeight = containerDom.clientHeight;
						if (fullHeight > 380) {
							viewport.style.height = Math.max(280, fullHeight - 60) + "px";
						} else {
							viewport.style.height = "280px";
						}
						var width = viewport.clientWidth;
						var height = viewport.clientHeight;
						if (width > 0 && height > 0) {
							frame.setWidth(width + "px");
							frame.setHeight(height + "px");
						}
					});
					observer.observe(containerDom);
					frame._chartResizeObserver = observer;
				}
			}
		},
		_chartContentWidth: function() {
			// Keep the plot fitted to its card for every data count; category spacing is
			// handled by the chart renderer rather than a wider, horizontally scrolled frame.
			return "100%";
		},
		_resizeVisibleCharts: function() {
			window.setTimeout(function() {
				this.getView().findAggregatedObjects(true, function(control) {
					return control.isA && control.isA("sap.viz.ui5.controls.VizFrame");
				}).forEach(function(frame) {
					var dom = frame.getDomRef();
					var viewport = dom && dom.closest(".chartViewport");
					if (viewport && viewport.clientWidth > 0 && viewport.clientHeight > 0) {
						frame.setWidth(viewport.clientWidth + "px");
						frame.setHeight(viewport.clientHeight + "px");
					}
				});
			}.bind(this), 100);
		},
		onExit: function() {
			this.getView().findAggregatedObjects(true, function(control) {
				var observer = control._chartResizeObserver;
				if (observer) {
					observer.disconnect();
				}
				return false;
			});
		},
		_chartLabel: function(value) {
			var label = String(value || "");
			var match = label.match(/^(?:WR-ME-M-)?([A-Z0-9]{2,6}-\d+)$/i);
			if (match) {
				return match[1].split("-").pop();
			}
			var segments = label.split("-");
			if (segments.length > 4) {
				return segments.slice(-2).join("-");
			}
			return label.length > 18 ? label.slice(0, 15) + "…" : label;
		},
		_wbsChartLabel: function(value) {
			var label = String(value || "").trim(),
				segments = label.split("-"),
				code = segments[segments.length - 1];
			return code || label;
		},

		/* ============================================================ */
		/* Data loading                                                 */
		/* ============================================================ */
		_loadProject: function(projectId) {
			var sProject = this._validateProject(projectId);
			if (!sProject) { return; }
			var oModel = this.getOwnerComponent().getModel();
			if (!oModel) {
				this._setStatus("The project data service is unavailable.", "Error");
				return;
			}
			this._resetState();
			this._dash().setData(emptyDash("Loading project data…"));
			this._setStatus("Loading project " + sProject + "…", "Information");
			this.byId("projectInput").setValueState("None");
			this.getView().setBusy(true);

			var readPromise = this._readAll(oModel, [new Filter("PROJ_PSPNR", FilterOperator.EQ, sProject)]);

			readPromise.then(function(rows) {
				this._renderData(rows);
				this.getView().setBusy(false);
				this.byId("refreshText").setText("Last Refreshed: " + new Date().toLocaleString());
				this._setStatus(rows.length ? "Loaded " + rows.length + " records for project " + sProject + "." :
					"No records found for project " + sProject + ".", rows.length ? "Success" : "Warning");
			}.bind(this)).catch(function(error) {
				this.getView().setBusy(false);
				var details = this._readBackendError(error);
				var noData = details.code === "CJ/011" || /project .+ does not exist/i.test(details.message);
				var message = noData ? "No data available for project " + sProject + "." :
					"We couldn’t load project data. Please try again.";
				this._resetState();
				this._dash().setData(emptyDash(message));
				this._setStatus(message, noData ? "Warning" : "Error");
				if (!noData) {
					MessageToast.show(message);
				}
			}.bind(this));
		},
		_readBackendError: function(error) {
			var body = error && (error.responseJSON || error.response && error.response.responseJSON);
			if (!body && error && error.responseText) {
				try {
					body = JSON.parse(error.responseText);
				} catch (parseError) {
					body = null;
				}
			}
			var details = body && body.error || {};
			var message = typeof details.message === "string" ? details.message : details.message && details.message.value;
			return {
				code: details.code || "",
				message: message || error && error.message || ""
			};
		},
		// Server-driven paging: follows __next using $skiptoken (or $skip as fallback) instead of
		// passing the absolute __next URL back into model.read(), which breaks on many gateways.
		_readAll: function(model, filters) {
			return new Promise(function(resolve, reject) {
				var rows = [];

				function read(urlParameters) {
					model.read("/ZCOST_SAVING_DDIC_TYPESet", {
						filters: filters,
						urlParameters: urlParameters || {},
						success: function(data) {
							rows = rows.concat(data.results || []);
							if (!data.__next) {
								resolve(rows);
								return;
							}
							var token = /[?&]\$skiptoken=([^&]+)/.exec(data.__next);
							read(token ? {
								"$skiptoken": decodeURIComponent(token[1])
							} : {
								"$skip": rows.length
							});
						},
						error: reject
					});
				}
				read();
			});
		},

		/* ============================================================ */
		/* Aggregation                                                  */
		/* ============================================================ */
		// One place builds a WBS group (used for full load AND for search-filtered groups).
		_aggregate: function(wbs, records, expanded) {
			var group = {
				key: wbs,
				wbs: wbs,
				records: records,
				serialKeys: Object.create(null),
				materialsById: Object.create(null),
				boqQty: 0,
				poQty: 0,
				boq: 0,
				po: 0,
				availability: 0,
				saving: 0,
				expanded: !!expanded
			};
			records.forEach(function(row) {
				group.serialKeys[String(row.BBU_SERIAL) + "|" + String(row.BBU_VERSION)] = true;
				group.boqQty += this._num(row.BOQ_QTY);
				group.poQty += this._num(row.PO_QTY);
				group.boq += this._num(row.BOQ_AMOUNT);
				group.po += this._num(row.POAMT);
				group.availability += this._num(row.AVAILABILITY);
				group.saving += this._num(row.SAVING);
				var id = row.SERVICE_OR_MATERIAL || "(No Material)";
				var item = group.materialsById[id] || (group.materialsById[id] = {
					label: id,
					boqQty: 0,
					poQty: 0,
					boq: 0,
					po: 0,
					saving: 0,
					availability: 0
				});
				item.boqQty += this._num(row.BOQ_QTY);
				item.poQty += this._num(row.PO_QTY);
				item.boq += this._num(row.BOQ_AMOUNT);
				item.po += this._num(row.POAMT);
				item.saving += this._num(row.SAVING);
				item.availability += this._num(row.AVAILABILITY);
			}, this);
			group.serialCount = Object.keys(group.serialKeys).length;
			group.materialCount = records.length;
			group.materials = Object.keys(group.materialsById).map(function(id) {
				return group.materialsById[id];
			});
			return group;
		},
		_renderData: function(rows) {
			this._rows = rows;
			var byWbs = Object.create(null),
				order = [];
			rows.forEach(function(row) {
				var wbs = row.WBS || "(No WBS)";
				if (!byWbs[wbs]) {
					byWbs[wbs] = [];
					order.push(wbs);
				}
				byWbs[wbs].push(row);
			});
			this._allWbs = order.map(function(wbs) {
				return this._aggregate(wbs, byWbs[wbs], false);
			}, this);
			this._visibleWbs = this._allWbs;
			this._filteredRows = rows;
			this._publish(this._visibleWbs, rows);
		},

		/* ============================================================ */
		/* Publish to the JSON model                                    */
		/* ============================================================ */
		_publish: function(groups, sourceRows) {
			var self = this,
				rows = sourceRows || [],
				first = rows[0] || {};

			var displayGroups = groups.map(function(group) {
				var materialData = group.materials.slice().sort(function(a, b) {
					return b.saving - a.saving || a.label.localeCompare(b.label);
				}).map(function(item) {
					var savingLakhs = item.saving / 100000;
					return {
						label: self._chartLabel(item.label),
						boqLakhs: item.boq / 100000,
						poLakhs: item.po / 100000,
						savingLakhs: savingLakhs,
						savingType: item.saving < 0 ? "Negative" : "Positive"
					};
				});
				var detailRows = group.records.map(function(row) {
					return Object.assign({}, row, {
						boqQtyFmt: self._quantity(row.BOQ_QTY),
						poQtyFmt: self._quantity(row.PO_QTY),
						boqRateFmt: self._rate(row.BOQ_RATE),
						poRateFmt: self._rate(row.PO_RATE),
						boqFmt: self._money(row.BOQ_AMOUNT),
						poFmt: self._money(row.POAMT),
						availabilityFmt: self._money(row.AVAILABILITY),
						savingFmt: self._money(row.SAVING),
						savingState: self._num(row.SAVING) < 0 ? "Error" : "Success"
					});
				});
				return Object.assign({}, group, {
					boqQtyFmt: self._quantity(group.boqQty),
					poQtyFmt: self._quantity(group.poQty),
					boqFmt: self._money(group.boq),
					poFmt: self._money(group.po),
					availabilityFmt: self._money(group.availability),
					savingFmt: self._money(group.saving),
					savingState: group.saving < 0 ? "Error" : "Success",
					chartWidth: self._chartContentWidth(),
					savingChartWidth: "100%",
					materialChartData: materialData,
					detailRows: detailRows
				});
			});

			var totals = rows.reduce(function(sum, row) {
				sum.boq += self._num(row.BOQ_AMOUNT);
				sum.po += self._num(row.POAMT);
				sum.availability += self._num(row.AVAILABILITY);
				sum.saving += self._num(row.SAVING);
				return sum;
			}, {
				boq: 0,
				po: 0,
				availability: 0,
				saving: 0
			});

			var sorted = groups.slice().sort(function(a, b) {
				return b.saving - a.saving || a.wbs.localeCompare(b.wbs);
			});
			var allSavingGroups = (this._allWbs || groups).slice().sort(function(a, b) {
				return b.saving - a.saving || a.wbs.localeCompare(b.wbs);
			});
			var limit = this._topCount || 10;
			var chartGroups = limit === "all" ? sorted : sorted.slice(0, limit);
			function chartRowsFor(groups) {
				return groups.map(function(group) {
					var savingLakhs = group.saving / 100000;
					return {
						label: self._wbsChartLabel(group.wbs),
						savingLakhs: savingLakhs,
						savingType: group.saving < 0 ? "Negative" : "Positive",
						boqLakhs: group.boq / 100000,
						poLakhs: group.po / 100000
					};
				});
			}
			var savingChartData = chartRowsFor(chartGroups);
			var allWbsChartData = chartRowsFor(sorted);
			var allWbsSavingData = chartRowsFor(allSavingGroups.filter(function(group) {
				return self._num(group.saving) !== 0;
			}));

			this._dash().setData({
				kpis: [{
					label: "Total WBS",
					value: groups.length,
					state: "None",
					sub: "Distinct WBS elements",
					icon: "sap-icon://org-chart"
				}, {
					label: "Total Materials",
					value: rows.length,
					state: "None",
					sub: "Material / service records",
					icon: "sap-icon://product"
				}, {
					label: "Original BBU",
					value: this._money(first.ORGINAL_BBU_AMOUNT),
					state: this._num(first.ORGINAL_BBU_AMOUNT) < 0 ? "Error" : "None",
					sub: "Backend value",
					icon: "sap-icon://database"
				}, {
					label: "Updated BBU",
					value: this._money(first.UPDATED_BBU_AMOUNT),
					state: this._num(first.UPDATED_BBU_AMOUNT) < 0 ? "Error" : "None",
					sub: "Backend value",
					icon: "sap-icon://database"
				}, {
					label: "BOQ Amount",
					value: this._money(totals.boq),
					state: totals.boq < 0 ? "Error" : "None",
					sub: "Material records",
					icon: "sap-icon://document"
				}, {
					label: "PO Amount",
					value: this._money(totals.po),
					state: totals.po < 0 ? "Error" : "None",
					sub: "Material records",
					icon: "sap-icon://cart"
				}, {
					label: "Availability",
					value: this._money(totals.availability),
					state: totals.availability < 0 ? "Error" : "None",
					sub: "Backend values",
					icon: "sap-icon://shipping-status"
				}, {
					label: "Total Saving",
					value: this._money(totals.saving),
					state: totals.saving < 0 ? "Error" : "None",
					sub: "Backend values",
					icon: "sap-icon://trend-up"
				}],
				wbsGroups: displayGroups,
				projectSavingData: savingChartData,
				allWbsSavingData: allWbsSavingData,
				projectChartData: allWbsChartData,
				projectChartWidth: this._chartContentWidth(),
				projectSavingWidth: "100%",
				savingChartTitle: SAVING_TITLE + " (" + (limit === "all" ? "All" : "Top " + limit) + ")",
				hasData: rows.length > 0,
				emptyMessage: rows.length ? "" : "No data found for this project."
			});
		},

		/* ============================================================ */
		/* WBS list interactions                                        */
		/* ============================================================ */
		onToggleWbs: function(event) {
			var context = event.getSource().getBindingContext("dash"),
				index = Number(context.getPath().split("/").pop()),
				group = this._visibleWbs[index];
			if (group) {
				group.expanded = !context.getProperty("expanded");
				// _visibleWbs may hold filtered copies; keep the master list in sync
				var original = (this._allWbs || []).find(function(item) {
					return item.key === group.key;
				});
				if (original) {
					original.expanded = group.expanded;
				}
				this._dash().setProperty(context.getPath() + "/expanded", group.expanded);
				if (group.expanded) {
					this._resizeVisibleCharts();
				}
			}
		},
		onExpandAll: function() {
			this._setExpansion(true);
		},
		onCollapseAll: function() {
			this._setExpansion(false);
		},
		_setExpansion: function(expanded) {
			var model = this._dash();
			(this._allWbs || []).forEach(function(group) {
				group.expanded = expanded;
			});
			(this._visibleWbs || []).forEach(function(group, index) {
				group.expanded = expanded;
				model.setProperty("/wbsGroups/" + index + "/expanded", expanded);
			});
			if (expanded) {
				this._resizeVisibleCharts();
			}
		},
		onTopChange: function(event) {
			var key = event.getParameter("selectedItem").getKey();
			this._topCount = key === "all" ? "all" : Number(key);
			if (this._rows && this._rows.length) {
				this._publish(this._visibleWbs || this._allWbs, this._filteredRows || this._rows);
			} else {
				this._dash().setProperty("/savingChartTitle", SAVING_TITLE + " (" + (this._topCount === "all" ? "All" : "Top " + this._topCount) +
					")");
			}
		},
		onSearch: function(event) {
			var query = (event.getParameter("newValue") || "").toLowerCase();
			this._visibleWbs = [];
			(this._allWbs || []).forEach(function(group) {
				if (!query || group.wbs.toLowerCase().indexOf(query) >= 0) {
					this._visibleWbs.push(group);
					return;
				}
				var matches = group.records.filter(function(row) {
					return [row.BBU_SERIAL, row.BBU_VERSION, row.SERVICE_OR_MATERIAL].join(" ").toLowerCase().indexOf(query) >= 0;
				});
				if (matches.length) {
					this._visibleWbs.push(this._aggregate(group.wbs, matches, group.expanded));
				}
			}, this);
			this._filteredRows = [];
			this._visibleWbs.forEach(function(group) {
				this._filteredRows = this._filteredRows.concat(group.records);
			}, this);
			if (this._rows && this._rows.length) {
				this._publish(this._visibleWbs, this._filteredRows);
			}
		},
		onMaterialSelect: function(event) {
			var row = event.getSource().getBindingContext("dash").getObject();
			MessageToast.show(row.SERVICE_OR_MATERIAL + " · BOQ " + this._money(row.BOQ_AMOUNT) + " · PO " + this._money(row.POAMT));
		},

		/* ============================================================ */
		/* Export                                                       */
		/* ============================================================ */
		onExport: function() {
			var rows = this._rows || [];
			if (!rows.length) {
				MessageToast.show("Nothing to export.");
				return;
			}
			var headings = ["WBS", "Serial Number", "Version", "Project ID", "Material / Service", "G/L Account", "BOQ Qty", "BOQ Rate",
				"BOQ Amount", "PO Qty", "PO Rate", "PO Amount", "Availability", "Saving"
			];
			var lines = [headings].concat(rows.map(function(row) {
				return [row.WBS, row.BBU_SERIAL, row.BBU_VERSION, row.PROJ_PSPNR, row.SERVICE_OR_MATERIAL, row.GL_ACCOUNT, row.BOQ_QTY, row.BOQ_RATE,
					row.BOQ_AMOUNT, row.PO_QTY, row.PO_RATE, row.POAMT, row.AVAILABILITY, row.SAVING
				];
			}));
			var csv = lines.map(function(line) {
				return line.map(function(value) {
					return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
				}).join(",");
			}).join("\r\n");
			var blob = new Blob(["\ufeff" + csv], {
					type: "text/csv;charset=utf-8;"
				}),
				url = URL.createObjectURL(blob),
				link = document.createElement("a");
			link.href = url;
			link.download = "project-cost-saving.csv";
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			setTimeout(function() {
				URL.revokeObjectURL(url);
			}, 1000);
		}
	});
});
