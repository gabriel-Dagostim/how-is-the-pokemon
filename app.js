//https://pokeapi.co/api/v2/pokemon/(Numero da pokedex)

var num1 = 0
var num2 = 0
var NamePoke = ""


function load(){
   

    if(num1 == 0){
        alert("Selecione uma geração")
    }else{
        clickbotaS()
    }

    idEscolha = Math.floor(Math.random() * (num2 - num1 + 1 ) + num1);
   
    let url = `https://pokeapi.co/api/v2/pokemon/${idEscolha}` 

    
    fetch(url)
    .then((Response) =>{
        return Response.json();

        



    })
    
    
    
    .then((data)=> {
    
        console.clear();    //limpa o console antes de aparecer o pokemon
        console.log(data);  //Aparece o pokemon escolhido no console
        
        document.getElementById('numero').innerHTML = "N°" + data['id'];
        let img = data['sprites']['front_default'];
        document.getElementById('pic1').setAttribute('src', img);   
        NamePoke = data['name'] 
    })
    
    .catch((erro) => {
        console.log("erro: " + erro);
     });   
    }
   


    
    document.getElementById('botaoS').onclick = load;

    function clickbotaS(){
        
    document.getElementById("IdStart").style.display = "block";
    document.getElementById("botaoS").style.display = "none";
    }


    function validation(){

        let Idchoice = document.getElementById('numero').innerHTML

        let PokedexNumber = (Idchoice.substring(2,6))
        
        let url = `https://pokeapi.co/api/v2/pokemon/${PokedexNumber}` 

        fetch(url)
        .then((Response) =>{
            return Response.json();

        })
        
        
        
        .then((data)=> {
        
            console.clear(); //limpa o console antes de aparecer o pokemon
            console.log(data); //Aparece o pokemon escolhido no console
            

            document.getElementById('numero').innerHTML = "N°" + data['id'];
            let img = data['sprites']['front_default'];
            document.getElementById('pic1').setAttribute('src', img);
    
                NamePoke = data['name']
                var writed = document.getElementById("input").value

             if(NamePoke != writed){                         
            
                var GetNP = parseInt(document.getElementById("errou").innerHTML)
                var GetNPN = GetNP + 1
                var GetNP = document.getElementById("errou").innerHTML =`  ${GetNPN}`
                var NameofThePoke = document.getElementById("TheNameOfPokemon").value;
                document.getElementById("TheNameOfPokemon").innerHTML = "O nome do pokemon era: " + NamePoke
                load()
             }else{

                var GetAcc = parseInt(document.getElementById("acertos").innerHTML)
                var CountAcc = GetAcc + 1
                var GetAcc = document.getElementById("acertos").innerHTML =`  ${CountAcc}`
                document.getElementById("input").value = ""
                load()

            


         }
          }
           )
            }

            function skip(){



                var DidHeJump = parseInt(document.getElementById("pulou").innerHTML)
        
                    document.getElementById("input").value = ""           
        
                var CountSkip = DidHeJump + 1
                var DidHeJump = document.getElementById("pulou").innerHTML =`  ${CountSkip}`
                
                document.getElementById("TheNameOfPokemon").innerHTML = "O nome do pokemon era: " + NamePoke
                    load()
            }

          



    function generation1(){

        num1 = 1
        num2 = 151
        load()
    };

    function generation2(){
        num1 = 152
        num2 = 251
        load()
    };

    function generation3(){
        num1 = 252
        num2 = 386
        load()
    };

    function generation4(){
        num1 = 387
        num2 = 493
        load()
    };

    function generation5(){
        num1 = 494
        num2 = 649
        load()
    };

    function generation6(){
        num1 = 650
        num2 = 721
        load()
    };

    function generation7(){
        num1 = 722
        num2 = 809
        load()
    };

    function generation8(){
        num1 = 810
        num2 = 890
        load()
    };

    function generation9(){
        num1 = 906
        num2 = 1008
        load()
    };