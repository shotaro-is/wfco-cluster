import {
  PCFSoftShadowMap,
  MeshPhysicalMaterial,
  TextureLoader,
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  Color,
  Mesh,
  SphereGeometry,
  Clock,
  Vector2,
  Vector3,
  Group,
  EquirectangularReflectionMapping,
  ACESFilmicToneMapping,
  Raycaster,
  Box3,
  Box3Helper
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { HDRJPGLoader } from '@monogrid/gainmap-js';
import Supercluster from "supercluster";

// Load Data
const now = Date.now();

let projects;

getJSON('./places2.json', (geojson) => {
    console.log(`loaded ${geojson.features.length} points JSON in ${(Date.now() - now) / 1000}s`);

    projects = new Supercluster({
        log: true,
        radius: 100,
        extent: 256,
        maxZoom: 17
    }).load(geojson.features);

    // console.log(projects.getClusters([-180, -90, 180, 90], 14)); //For the given bbox array ([westLng, southLat, eastLng, northLat]) and integer zoom
    // // console.log(index)
    // console.log(projects.getClusters([-180, -90, 180, 90], 14)[0]["geometry"]["coordinates"])
    postMessage({ready: true});
});

let ufosData = {}
let zoomLevels = [0, 1, 2, 3, 4, 5, 6, 7]

// Set 3D Scene
let scene = new Scene();

let camera = new PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 15, 50);

// Renderer
let renderer = new WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
document.body.appendChild(renderer.domElement);

// Raycaster
let pointer = new Vector2();
let raycaster = new Raycaster();
raycaster.far = 50;


// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.dampingFactor = 0.05;
controls.enableDamping = true;
controls.minDistance = 10;
controls.maxDistance = 52.3;

// Load, Model, Animate
(async function () {
  // let envMap
  try{
    
    //HDRI
    const hdrLoader = new HDRJPGLoader(renderer);
    let envmapTexture = await hdrLoader.loadAsync('./cannon_1k.jpg')

    scene.environment = envmapTexture.renderTarget.texture
    scene.environment.mapping = EquirectangularReflectionMapping
    scene.environmentIntensity = 1;
    let envMap = envmapTexture.renderTarget.texture
    envMap.mapping = EquirectangularReflectionMapping

    // Texture
    let textures = {
      bump: await new TextureLoader().loadAsync('./earthbump-min.jpg'),
    }

    // Draco Loader
    const dLoader = ( await new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/').setDecoderConfig({type: 'js'}));
    
    // Continent
    let continent = ( await new GLTFLoader().setDRACOLoader(dLoader).loadAsync('./continent-draco.glb')).scene.children[0];

    textures.bump.flipY = false;

    let continentMaterial = new MeshPhysicalMaterial({
      bumpMap: textures.bump,
      bumpScale: 10,
      roughness: 0.6,
      envMapIntensity: 1.3,
      transmission: 0.4,
      thickness: 0,
    });

    continent.traverse((o) => {
      if (o.isMesh) o.material = continentMaterial;
      o.castShadow = false;
    })

    const continentScale = 20
    continent.scale.set(continentScale , continentScale, continentScale);
    continent.rotation.y -= Math.PI * 1.389;
    continent.rotation.x -= Math.PI * 0.01;

    continent.name = "continent"
    
    scene.add(continent)

    // Ocean
    let ocean = new Mesh(
      new SphereGeometry(10, 70, 70),
      new MeshPhysicalMaterial({
        color: new Color("#006B6D"),
        // envMap,
        envMapIntensity: 3,
        roughness: 0,
        transparent: true,
        transmission: 1,
        opacity: 0.1
      }),
    );

    ocean.receiveShadow = true;
    ocean.name = "ocean";

    scene.add(ocean);
 

    // Load UFO
    let ufo = ( await new GLTFLoader().setDRACOLoader(dLoader).loadAsync('./element-5-draco.glb')).scene.children[0];

    zoomLevels.forEach( (level) =>{
      ufosData[level] = []
      projects.getClusters([-180, -90, 180, 90], level).forEach((index) =>{
        ufosData[level].push(makeUFO(ufo, scene, 3, index["geometry"]['coordinates'][0], index["geometry"]['coordinates'][1]))
      })
    })

    // Resize
    window.addEventListener( 'resize', resizeWindow );

    // Hover Event
    renderer.domElement.addEventListener('pointermove', onPointerMove);
 
    // Animation
    let clock = new Clock();

    let prevZoom = 0;

    ufosData[prevZoom].forEach( (ufoData) => {
      let ufo = ufoData.group;

      // scene.add(ufo)
      ufo.visible = true
      // let ufo = ufoData.group;

      ufo.position.set(0, 0, 0);
      ufo.rotation.set(0, 0, 0);
      ufo.updateMatrixWorld();
      ufo.scale.set(5*52*0.1/50, 2*52*0.1/50, 5*52*0.1/50)

      // ufoData.lngRot += delta * 0.03;
      ufo.rotateOnAxis(new Vector3(0, 0, 1), ufoData.latRot); // Latitude Rotation
      ufo.rotateOnWorldAxis(new Vector3(0, 1, 0), ufoData.lngRot); // Longtitude Rotation
      ufo.rotateOnAxis(new Vector3(0, 1, 0), -20*ufoData.lngRot); // ufo rotation
      ufo.translateY(ufoData.yOff);

      ufoData.box.setFromObject(ufo);
    });

    let deltaLngRot = 0

    // Animation Loop
    renderer.setAnimationLoop(() => {

      let delta = clock.getDelta();

      let distance = camera.position.distanceTo( controls.target );

      var currentZoom = Math.abs(Math.round(-0.2 * distance + 10))
      if (currentZoom > 7) currentZoom = 7
      console.log(currentZoom)
      
      deltaLngRot += delta * 0.03;

      // continent.rotation.y = deltaLngRot;

      if (currentZoom === prevZoom && ufosData[currentZoom] ) {

          ufosData[currentZoom].forEach( (ufoData) => {
          let ufo = ufoData.group;
    
          // let ufo = ufoData.group;

          ufo.position.set(0, 0, 0);
          ufo.rotation.set(0, 0, 0);
          ufo.updateMatrixWorld();
          const size = (18 - currentZoom) * 0.6
          ufo.scale.set(size*distance*0.1/50, size*distance*0.1/50, size*distance*0.1/50)

          // ufoData.lngRot += delta * 0.03;
          ufo.rotateOnAxis(new Vector3(0, 0, 1), ufoData.latRot); // Latitude Rotation
          ufo.rotateOnWorldAxis(new Vector3(0, 1, 0), ufoData.lngRot); // Longtitude Rotation
          ufo.rotateOnAxis(new Vector3(0, 1, 0), -20*(ufoData.lngRot)); // ufo rotation
          ufo.translateY(ufoData.yOff);

          ufoData.box.setFromObject(ufo);
          });
      }

      if (currentZoom != prevZoom && ufosData[currentZoom] ) {
       
        ufosData[prevZoom].forEach( (ufoData) => {
          let prevUfo = ufoData.group;
          // console.log(prevUfo)
          // scene.remove(prevUfo)
          prevUfo.visible = false
          console.log(prevUfo.visible)
        });

        ufosData[currentZoom].forEach( (ufoData) => {
        let ufo = ufoData.group;
        ufo.visible = true
        // console.log(ufoData)
        // console.log(key)
        // console.log (unvisibleData)
        // scene.add(u
        // console.log(visibleData)
  
        // let ufo = ufoData.group;

        ufo.position.set(0, 0, 0);
        ufo.rotation.set(0, 0, 0);
        ufo.updateMatrixWorld();

        const size = (18 - currentZoom) * 0.6
        ufo.scale.set(size*distance*0.1/50, size*distance*0.1/50, size*distance*0.1/50)

        // ufoData.lngRot += delta * 0.03;
        ufo.rotateOnAxis(new Vector3(0, 0, 1), ufoData.latRot+deltaLngRot); // Latitude Rotation
        ufo.rotateOnWorldAxis(new Vector3(0, 1, 0), ufoData.lngRot+deltaLngRot); // Longtitude Rotation
        ufo.rotateOnAxis(new Vector3(0, 1, 0), -20*ufoData.lngRot+deltaLngRot); // ufo rotation
        ufo.translateY(ufoData.yOff);

        ufoData.box.setFromObject(ufo);
        });
      }

      prevZoom = currentZoom


      controls.update();
      renderer.render(scene, camera);

    });
} catch(err){
  console.log(err)
}
})();

function getJSON(url, callback) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.responseType = 'json';
  xhr.setRequestHeader('Accept', 'application/json');
  xhr.onload = function () {
      if (xhr.readyState === 4 && xhr.status >= 200 && xhr.status < 300 && xhr.response) {
          callback(xhr.response);
      }
  };
  xhr.send();
}


function makeUFO(ufoMesh, scene, size, lat, lng) {
  // ufoMesh: the Mesh of ufo
  // Scene: Instance of THREE.scene()
  // Size: The size / importance / progress of each project, 3 sizes: 1, 2, 3
  // lat: Latitude North => Plus South => Minus Lookup "city name coordinates" on google
  // lng: Langitude East => Plus West => Minus

  // There are 3 sizes: 3, 2, 1
  let ufo = ufoMesh.clone();
  // if (size == 3) {
  //   ufo.scale.set(5, 2, 5);
  // } else if (size == 2){
  //   ufo.scale.set(3, 2, 3);
  // } else if (size == 1){
  //   ufo.scale.set(1.8, 2, 1.8);
  // } else console.log(`Undifined size of UFO for location {Latitude: ${lat}, longitude: ${lng}`)
  ufo.scale.set(5, 2, 5)
  
  ufo.position.set(0,0,0);
  ufo.rotation.set(0,0,0);
  ufo.updateMatrixWorld();

  ufo.traverse((o) => {
    if (o.isMesh) {
      o.material = new MeshPhysicalMaterial({
      roughness: 1,
      metalness: 1,
      color: new Color("#dcfd7c"),
      envMapIntensity: 1,
      })
      
    // For reset color
    if (!o.material.userData) {
      o.material.userData = {};
    }
    o.material.userData.color = o.material.color.clone();
  };
  })


  let group = new Group();
  group.add(ufo);
  group.visible = false
  scene.add(group);

  // Bounding Hit Box
  let box = new Box3().setFromObject(ufo);
  
  // Debug yse to see Hit Box
  // const helper = new Box3Helper( box, 0xffff00 );
  // scene.add(helper)

  return {
    group,
    box,
    rot: 0,
    rad: Math.random() * Math.PI * 0.45 + 0.5,
    // yOff: 10.3,
    yOff: 10.3 + Math.random() * 0.2,
    latRot: -lat / 90 * Math.PI/2 + Math.PI/2,
    lngRot: Math.PI * lng / 180 + Math.PI / 3 + 0.2 ,
  };

}

function nr (){
  return Math.random() * 2 - 1;
}

function resizeWindow() {

  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize( innerWidth, innerHeight );

}


function onPointerMove(event) {
  // console.log(ufosData)

	pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  
  raycaster.setFromCamera(pointer, camera);


  // Reset Colors
  scene.traverse( function( object ) {
   
    if ( object.isMesh === true &&object.name != "continent" && object.name !="ocean"){
      object.material.color.copy( object.material.userData.color );
    }
  });

  // const intersects = raycaster.intersectObjects(scene.children, true);
  // for (let i = 0; i < intersects.length; i++) {
  //   if (intersects[i].distance <= raycaster.far) {
  //     console.log('Intersection detected within range with UFO at', intersects[i].point);
  //     intersects[i].object.traverse((object) => {
  //       if (object.isMesh) {
  //         object.material.color.set(0xff0000); // Set to red or any other color
  //       }
  //     });
  //     // break; // Optional: break if you only care about the first intersection
  //   }
  // }
  
  // for (let ufoData of ufosData) {//
  for (var key in ufosData) {
    ufosData[key].forEach((ufoData) => {
      let intersectionPoint = new Vector3(); // Create a new Vector3 to store the intersection point
      if (raycaster.ray.intersectBox(ufoData.box, intersectionPoint) !== null) {
        // Calculate the distance from the camera to the intersection point
        let distance = intersectionPoint.distanceTo(camera.position);
        if (distance <= raycaster.far) {
          console.log('Intersection detected with UFO at', intersectionPoint, 'at distance', distance);
          // Change color of the UFO
          ufoData.group.traverse((object) => {
            if (object.isMesh) {
              object.material.color.set(0xff0000); // Set to red or any other color
            }
          });
        }
      }
    })
  }

}


