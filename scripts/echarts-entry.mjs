// Slim ECharts bundle for the dashboard: only the chart types and components
// dist/js/charts.js uses (the full build is ~3x larger to download and parse).
// Built by `npm run vendor`; add a component here before using it in a chart.
import * as echarts from 'echarts/core';
import { LineChart, BarChart, HeatmapChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, AxisPointerComponent, LegendComponent, DataZoomComponent, VisualMapComponent,
  CalendarComponent, MarkLineComponent, MarkAreaComponent, MarkPointComponent, GraphicComponent, AriaComponent,
} from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart, BarChart, HeatmapChart,
  GridComponent, TooltipComponent, AxisPointerComponent, LegendComponent, DataZoomComponent, VisualMapComponent,
  CalendarComponent, MarkLineComponent, MarkAreaComponent, MarkPointComponent, GraphicComponent, AriaComponent,
  LabelLayout, CanvasRenderer,
]);
window.echarts = echarts;
