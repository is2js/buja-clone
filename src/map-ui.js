import { resizeMapView } from './map.js';

// Keep DOM handles and observers out of Alpine's reactive state.
export function createMapUIController() {
  let observer, resizeFrame, previousFocus, previousOverflow, savedScroll;
  let keyHandler;
  return {
    mapExpanded:false, layersOpen:false, mapDimensions:{width:440,height:572},
    setupMapUI() {
      const surface=this.$refs.mapPage?.querySelector('#mapWrap');
      if (!surface) return;
      const update=()=>{ cancelAnimationFrame(resizeFrame); resizeFrame=requestAnimationFrame(()=>this.resizeMapViewport()); };
      observer=new ResizeObserver(update); observer.observe(surface);
      keyHandler=event=>{
        if (!this.mapExpanded || event.defaultPrevented) return;
        if (event.key==='Escape') {
          if (this.selectedRegion || this.selectedApartment || this.selectedGtx) { this.closeDetail(); event.preventDefault(); return; }
          // The building popup handles Escape before it reaches window.
          if (this.$refs.mapPage.querySelector('.scene-building-pinned')) return;
          if (this.layersOpen) this.layersOpen=false;
          else this.toggleMapExpanded();
          event.preventDefault();
        }
        if (event.key==='Tab' && !this.selectedRegion && !this.selectedApartment && !this.selectedGtx) {
          const elements=[...this.$refs.mapPage.querySelectorAll('button,input,select,a[href],summary,[tabindex="0"]')].filter(el=>!el.disabled && el.getClientRects().length);
          const first=elements[0],last=elements.at(-1);
          if (event.shiftKey && document.activeElement===first) {event.preventDefault();last?.focus();}
          else if (!event.shiftKey && document.activeElement===last) {event.preventDefault();first?.focus();}
        }
      };
      window.addEventListener('keydown',keyHandler);
      this.resizeMapViewport();
    },
    resizeMapViewport() {
      const box=this.$refs.mapPage?.querySelector('#mapWrap')?.getBoundingClientRect();
      if (!box || box.width<1 || box.height<1) return;
      const dimensions={width:box.width,height:box.height};
      if (Math.abs(dimensions.width-this.mapDimensions.width)<.5 && Math.abs(dimensions.height-this.mapDimensions.height)<.5) {this.resizeScene?.();return;}
      if (this.mapDrag || Object.keys(this.mapPointers || {}).length) this.onMapPointerCancel?.();
      this.mapDimensions=dimensions;
      if (this.mapView) this.mapView=resizeMapView(this.mapView,dimensions);
      this.resizeScene?.();
      this.renderMap(); this.scheduleTerrain?.();
    },
    async toggleMapExpanded() {
      if (!this.mapExpanded) {
        previousFocus=document.activeElement;
        previousOverflow=document.body.style.overflow;
        savedScroll=[window.scrollX,window.scrollY];
        document.body.style.overflow='hidden';
        this.mapExpanded=true;
      } else {
        this.mapExpanded=false;
        document.body.style.overflow=previousOverflow ?? '';
      }
      await this.$nextTick();
      this.resizeMapViewport();
      if (this.mapExpanded) this.$refs.mapPage?.querySelector('[data-map-expand]')?.focus({preventScroll:true});
      else {
        previousFocus?.focus?.({preventScroll:true});
        if (savedScroll) window.scrollTo(...savedScroll);
      }
    },
    destroyMapUI() {
      observer?.disconnect(); cancelAnimationFrame(resizeFrame);
      if (keyHandler) window.removeEventListener('keydown',keyHandler);
      if (this.mapExpanded) document.body.style.overflow=previousOverflow ?? '';
    },
  };
}
